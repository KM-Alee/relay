// Lead engine plumbing (docs/03-lead-engine.md §5). Owner: Lane A.
// Every transition: withWorkspaceTx → lockLead (FOR UPDATE) → domain decision (guard re-check) →
// UPDATE … WHERE version=$v (must hit 1 row) → lead_events + notifications + audit + outbox
// (Slack via enqueueSlackAlert, wake via ensureWakeBy) + realtime hint. All in the caller's tx.
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { append as auditAppend, systemActor, type AuditActor } from '../audit/index';
import { clock } from '../clock';
import {
  P0_FLAGS,
  type Applied,
  type EngineContext,
  type EngineFlags,
  type LeadSnapshot,
  type RoutingTrace,
  type TraceEntry,
} from '../domain/leads';
import { AppError } from '../errors';
import { ensureWakeBy } from '../jobs/scheduler';
import { enqueueWith } from '../jobs/outbox';
import { jobRegistry } from '../jobs/registry';
import { emit } from '../realtime/index';
import * as leadsRepo from '../repos/leads';
import * as teamsRepo from '../repos/teams';
import { enqueueSlackAlert } from './slack';

/** Postgres owns time (AGENTS.md rule 2): the statement timestamp of the current tx. */
export async function dbNow(tx: Tx): Promise<Date> {
  const r = await tx.execute<{ now: Date | string }>(sql`select statement_timestamp() as now`);
  return new Date(r.rows[0]!.now);
}

/** Workspace `ff_*` settings → engine flags. Everything off = P0 (AGENTS.md rule 8). */
export function flagsFromSettings(s: Record<string, unknown>): EngineFlags {
  const on = (k: string) => s[k] === true;
  return {
    ...P0_FLAGS,
    firstToClaim: on('ff_first_to_claim'),
    skillsRouting: on('ff_skills_routing'),
    perEmployeeCapacity: on('ff_per_employee_capacity'),
    idleRetrigger: on('ff_idle_retrigger'),
    urgentWindows: on('ff_urgent_windows'),
    pondClaim: on('ff_pond_claim'),
  };
}

export interface LoadedEngine {
  ctx: EngineContext;
  team: teamsRepo.TeamRow;
}

/**
 * Load everything the pure engine needs for one team, locking the team row so capacity and the
 * round-robin cursor are decided serially across concurrent transitions (03 §5, §9).
 */
export async function loadEngine(
  tx: Tx,
  workspaceId: string,
  teamId: string,
  now: Date,
  extraPeople: readonly string[] = [],
): Promise<LoadedEngine> {
  const ws = await teamsRepo.workspaceRouting(tx, workspaceId);
  const team = await teamsRepo.getTeam(tx, teamId, true);
  if (!ws || !team) throw new AppError('INTERNAL', { message: 'lead engine: workspace/team missing' });
  const policy = await teamsRepo.loadPolicy(tx, team.escalationPolicyId);
  const designated = [
    team.managerUserId,
    team.backupUserId,
    ws.ownerUserId,
    ...policy.levels.map((l) => l.targetUserId),
    ...extraPeople,
  ];
  const people = await teamsRepo.loadPeople(tx, team.id, designated);
  const warp = { timeWarpMultiplier: ws.timeWarpMultiplier };
  return {
    team,
    ctx: {
      now,
      deadline: (from, seconds) => clock.deadline(warp, seconds, from),
      team: teamsRepo.toTeamConfig(team),
      policy,
      people,
      workspaceOwnerUserId: ws.ownerUserId,
      flags: flagsFromSettings(ws.settings),
    },
  };
}

/** Human trace sentence for alerts (F3.11). The UI renders the trace with i18n templates instead. */
export function traceSentence(trace: RoutingTrace | null, nameOf: (id: string) => string): string {
  if (!trace?.length) return '';
  const part = (e: TraceEntry): string => {
    switch (e.outcome) {
      case 'skipped':
        return e.reason === 'at_capacity'
          ? `skipped ${e.name ?? '?'} (${e.openCount}/${e.capacity} open leads)`
          : `skipped ${e.name ?? '?'} (${e.reason.replace(/_/g, ' ')})`;
      case 'chosen':
        return `assigned ${e.name} (${e.reason.replace(/_/g, ' ')})`;
      case 'broadcast':
        return `offered to ${e.name}`;
      case 'fallback':
        return `held by ${e.name || nameOf(e.userId)} as fallback custodian (${e.awaitingReason.replace(/_/g, ' ')})`;
    }
  };
  const s = trace.map(part).join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface LeadLabels {
  contactName: string;
  sourceLabel: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
const jsonish = (o: Partial<LeadSnapshot>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, iso(v)])) as Record<string, unknown>;

/**
 * Persist an Applied result in the caller's tx. `prev` = null → insert (intake; `extras` required).
 * Throws STALE_VERSION when the versioned update hits 0 rows (lost race → whole tx rolls back).
 */
export async function persist(
  tx: Tx,
  eng: LoadedEngine,
  prev: LeadSnapshot | null,
  r: Applied,
  o: { actor: AuditActor; labels: LeadLabels; extras?: leadsRepo.LeadIntakeExtras },
): Promise<void> {
  if (!r.changed) return;
  const lead = r.next;
  const ws = lead.workspaceId;
  if (prev === null) {
    if (!o.extras) throw new AppError('INTERNAL', { message: 'persist: intake needs extras' });
    await leadsRepo.insertLead(tx, lead, o.extras);
  } else if (!(await leadsRepo.updateLeadVersioned(tx, lead.id, prev.version, r.patch))) {
    throw new AppError('STALE_VERSION', { details: { leadId: lead.id } });
  }
  if (r.newRrCursor !== null) await teamsRepo.setRrCursor(tx, eng.team.id, r.newRrCursor);
  await leadsRepo.insertEvents(tx, ws, lead.id, r.events);
  await leadsRepo.insertNotifications(tx, ws, r.notifications);

  const nameOf = (id: string) => eng.ctx.people.find((p) => p.userId === id)?.name ?? '';
  const reasonTrace = r.events.find((e) => e.trace)?.trace ?? null;
  for (const out of r.outbox) {
    if (out.type === 'slack.send') {
      const p = out.payload;
      if (p.purpose === 'claimable') continue; // P1 Claim button (T-222)
      const purpose =
        p.purpose === 'escalated' || p.purpose === 'critical'
          ? p.purpose
          : lead.custody === 'fallback' && p.userId === lead.ownerUserId
            ? 'fallback'
            : 'assigned';
      await enqueueSlackAlert(tx, {
        workspaceId: ws,
        userId: p.userId,
        leadId: lead.id,
        leadVersion: p.leadVersion,
        purpose,
        leadName: o.labels.contactName,
        source: o.labels.sourceLabel,
        reason: traceSentence(reasonTrace, nameOf) || purpose,
        level: lead.escalationLevel,
        deadlineAt: lead.ackWindowEndsAt,
      });
    } else if (jobRegistry.has(out.type)) {
      // ai.handoff is enqueued only once Lane C registers its handler (AI is optional, rule 7).
      await enqueueWith(tx, { type: out.type, payload: out.payload, dedupeKey: out.dedupeKey }, jobRegistry);
    }
  }

  const before = prev
    ? jsonish(Object.fromEntries(Object.keys(r.patch).map((k) => [k, prev[k as keyof LeadSnapshot]])))
    : null;
  for (const a of r.audit) {
    await auditAppend(tx, a.actor.type === 'system' ? systemActor(ws) : o.actor, {
      action: a.action,
      targetType: 'lead',
      targetId: lead.id,
      before,
      after: jsonish(r.patch),
      meta: a.meta,
    });
  }
  if (r.wakeAt) await ensureWakeBy(tx, r.wakeAt);
  await emit(tx, { workspaceId: ws, topic: 'leads', ids: [lead.id] });
  await emit(tx, { workspaceId: ws, topic: 'recovery', ids: [lead.id] });
  for (const uid of new Set(r.notifications.map((n) => n.userId))) {
    await emit(tx, { workspaceId: ws, topic: 'notifications', ids: [lead.id], userId: uid });
  }
}

/** Labels for alerts, read from the lead row. */
export const labelsOf = (row: leadsRepo.LeadRow): LeadLabels => ({
  contactName: row.contactName,
  sourceLabel: row.sourceLabel,
});
