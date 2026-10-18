// Escalation policies, simulation, intake settings (F3.5, F3.1). Owner: Lane A (T-124 form, T-202 builder).
// Publish = replace the levels + bump `version` in ONE tx, audited. The first level's timeout is the
// first acknowledgement window (the engine uses teams.ack_window_seconds at intake), so publishing keeps
// it in sync for every team that uses the policy.
import type {
  PolicyDto,
  PolicyLevelInput,
  SimulateResponse,
  SimulateStep,
  WebFormDto,
} from '@relay/contracts/api/automations';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { escalationLevels, escalationPolicies, teams, webForms } from '@relay/db/schema';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import {
  escalateOnAckTimeout,
  intake,
  type EngineContext,
  type EscalationPolicy,
  type LeadEventIntent,
  type LeadSnapshot,
} from '../domain/leads';
import { AppError, notFound, staleVersion } from '../errors';
import { uuidv7 } from '../ids';
import { emit } from '../realtime/index';
import * as teamsRepo from '../repos/teams';
import { flagsFromSettings } from './lead-engine';

const toLevels = (levels: readonly PolicyLevelInput[]) =>
  levels.map((l, i) => ({
    position: i + 1,
    targetType: l.targetType,
    targetUserId: l.targetType === 'user' ? (l.targetUserId ?? null) : null,
    timeoutSeconds: l.timeoutSeconds,
  }));

async function dtoOf(tx: Tx, policyId: string): Promise<PolicyDto> {
  const all = await listIn(tx, policyId);
  const p = all[0];
  if (!p) throw notFound();
  return p;
}

async function listIn(tx: Tx, onlyId?: string): Promise<PolicyDto[]> {
  const policies = await tx
    .select()
    .from(escalationPolicies)
    .where(onlyId ? eq(escalationPolicies.id, onlyId) : undefined)
    .orderBy(asc(escalationPolicies.createdAt));
  if (!policies.length) return [];
  const ids = policies.map((p) => p.id);
  const levels = await tx
    .select()
    .from(escalationLevels)
    .where(inArray(escalationLevels.policyId, ids))
    .orderBy(asc(escalationLevels.position));
  const ts = await tx.select({ id: teams.id, policyId: teams.escalationPolicyId }).from(teams);
  return policies.map((p) => ({
    id: p.id,
    name: p.name,
    repeatCount: p.repeatCount,
    version: p.version,
    updatedAt: p.updatedAt.toISOString(),
    levels: levels
      .filter((l) => l.policyId === p.id)
      .map((l) => ({
        position: l.position,
        targetType: l.targetType,
        targetUserId: l.targetUserId,
        timeoutSeconds: l.timeoutSeconds,
      })),
    teamIds: ts.filter((t) => t.policyId === p.id).map((t) => t.id),
  }));
}

export async function list(actor: Actor, opts: TxOptions = {}): Promise<{ items: PolicyDto[] }> {
  assertPermission(actor, 'routing.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => ({ items: await listIn(tx) }), opts);
}

async function assertUsersExist(tx: Tx, levels: readonly PolicyLevelInput[]): Promise<void> {
  const ids = [
    ...new Set(levels.map((l) => (l.targetType === 'user' ? l.targetUserId : null)).filter(Boolean)),
  ];
  if (!ids.length) return;
  const res = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from users where is_active and id = any(${`{${ids.join(',')}}`}::uuid[])`,
  );
  if (Number(res.rows[0]?.n) !== ids.length)
    throw new AppError('VALIDATION_FAILED', { details: { field: 'levels', reason: 'unknown_user' } });
}

async function writeLevels(
  tx: Tx,
  workspaceId: string,
  policyId: string,
  levels: readonly PolicyLevelInput[],
) {
  await tx.delete(escalationLevels).where(eq(escalationLevels.policyId, policyId));
  await tx
    .insert(escalationLevels)
    .values(toLevels(levels).map((l) => ({ id: uuidv7(), workspaceId, policyId, ...l })));
}

/** First level's timeout = the first acknowledgement window for every team on this policy. */
async function syncAckWindow(tx: Tx, policyId: string, firstTimeout: number): Promise<void> {
  await tx
    .update(teams)
    .set({ ackWindowSeconds: firstTimeout, version: sql`${teams.version} + 1` })
    .where(and(eq(teams.escalationPolicyId, policyId), ne(teams.ackWindowSeconds, firstTimeout)));
}

export async function create(
  actor: Actor,
  input: { name: string; repeatCount: number; levels: PolicyLevelInput[] },
  opts: TxOptions = {},
): Promise<PolicyDto> {
  assertPermission(actor, 'routing.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      await assertUsersExist(tx, input.levels);
      const id = uuidv7();
      await tx
        .insert(escalationPolicies)
        .values({ id, workspaceId: actor.workspaceId, name: input.name, repeatCount: input.repeatCount });
      await writeLevels(tx, actor.workspaceId, id, input.levels);
      const dto = await dtoOf(tx, id);
      await auditAppend(tx, actor, {
        action: 'escalation_policy.changed',
        targetType: 'escalation_policy',
        targetId: id,
        before: null,
        after: { name: dto.name, repeatCount: dto.repeatCount, levels: dto.levels, version: dto.version },
      });
      return dto;
    },
    opts,
  );
}

/** Publish (T-202): versioned replace. Pending leads keep their current deadlines; new windows use the new values. */
export async function publish(
  actor: Actor,
  id: string,
  input: { name?: string; repeatCount: number; levels: PolicyLevelInput[]; version: number },
  opts: TxOptions = {},
): Promise<PolicyDto> {
  assertPermission(actor, 'routing.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const cur = (
        await tx.select().from(escalationPolicies).where(eq(escalationPolicies.id, id)).for('update')
      )[0];
      if (!cur) throw notFound();
      if (cur.version !== input.version) throw staleVersion(cur.version);
      await assertUsersExist(tx, input.levels);
      const before = await dtoOf(tx, id);
      await tx
        .update(escalationPolicies)
        .set({
          name: input.name ?? cur.name,
          repeatCount: input.repeatCount,
          version: cur.version + 1,
        })
        .where(eq(escalationPolicies.id, id));
      await writeLevels(tx, actor.workspaceId, id, input.levels);
      await syncAckWindow(tx, id, input.levels[0]!.timeoutSeconds);
      const dto = await dtoOf(tx, id);
      await auditAppend(tx, actor, {
        action: 'escalation_policy.changed',
        targetType: 'escalation_policy',
        targetId: id,
        before: {
          name: before.name,
          repeatCount: before.repeatCount,
          levels: before.levels,
          version: before.version,
        },
        after: { name: dto.name, repeatCount: dto.repeatCount, levels: dto.levels, version: dto.version },
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team', ids: dto.teamIds });
      return dto;
    },
    opts,
  );
}

// ── Test panel: a simulated lead through the PURE domain (no writes) ─────────

const SIM_START = new Date('2026-01-01T09:00:00.000Z');
const plain = (from: Date, s: number) => new Date(from.getTime() + s * 1000);

export async function simulate(
  actor: Actor,
  input: { teamId: string; repeatCount: number; levels: PolicyLevelInput[]; urgent?: boolean },
  opts: TxOptions = {},
): Promise<SimulateResponse> {
  assertPermission(actor, 'routing.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const team = await teamsRepo.getTeam(tx, input.teamId);
      const ws = await teamsRepo.workspaceRouting(tx, actor.workspaceId);
      if (!team || !ws) throw notFound();
      const levels = toLevels(input.levels);
      const policy: EscalationPolicy = {
        id: 'draft',
        repeatCount: input.repeatCount,
        levels,
      };
      const people = await teamsRepo.loadPeople(tx, team.id, [
        team.managerUserId,
        team.backupUserId,
        ws.ownerUserId,
        ...levels.map((l) => l.targetUserId),
      ]);
      const cfg = { ...teamsRepo.toTeamConfig(team), ackWindowSeconds: levels[0]!.timeoutSeconds };
      const nameOf = (id: string | null) => (id ? (people.find((p) => p.userId === id)?.name ?? null) : null);
      const base: Omit<EngineContext, 'now'> = {
        deadline: plain,
        team: cfg,
        policy,
        people,
        workspaceOwnerUserId: ws.ownerUserId,
        flags: flagsFromSettings(ws.settings),
      };
      const steps: SimulateStep[] = [];
      const secs = (d: Date) => Math.round((d.getTime() - SIM_START.getTime()) / 1000);
      const toStep = (
        lead: LeadSnapshot,
        events: LeadEventIntent[],
        fromName: string | null,
        kind: SimulateStep['kind'],
        at: Date,
      ): SimulateStep => {
        const ev = events.find((e) => e.trace) ?? events[0]!;
        return {
          atSeconds: secs(at),
          kind,
          level: lead.escalationLevel,
          toUserId: lead.ownerUserId,
          toName: nameOf(lead.ownerUserId),
          fromName,
          skipped: (ev.trace ?? [])
            .filter((t) => t.outcome === 'skipped')
            .map((t) =>
              t.outcome === 'skipped' ? { name: t.name, reason: t.reason } : { name: null, reason: '' },
            ),
          custody: lead.custody,
          waitSeconds: lead.escalateAt ? Math.round((lead.escalateAt.getTime() - at.getTime()) / 1000) : null,
        };
      };

      let ctx: EngineContext = { ...base, now: SIM_START };
      const first = intake(ctx, {
        id: 'sim',
        workspaceId: actor.workspaceId,
        isUrgent: input.urgent ?? false,
        actor: { type: 'system' },
      });
      let lead = first.next;
      let rr = first.newRrCursor ?? cfg.rrCursor;
      steps.push(toStep(lead, first.events, null, 'assigned', SIM_START));
      let tried: string[] = lead.custody === 'handler' ? [lead.ownerUserId] : [];

      for (let i = 0; i < 40 && lead.escalateAt; i++) {
        const now = lead.escalateAt;
        ctx = { ...base, now, team: { ...cfg, rrCursor: rr } };
        const r = escalateOnAckTimeout(ctx, lead, { triedThisCycle: tried });
        if (!r.ok || !r.changed) break;
        const fromName = nameOf(lead.ownerUserId);
        const type = r.events.some((e) => e.type === 'critical_flagged')
          ? 'critical'
          : r.events.some((e) => e.type === 'escalation')
            ? 'escalated'
            : 'overdue';
        if (r.newRrCursor !== null) rr = r.newRrCursor;
        if (type === 'overdue' || type === 'critical') tried = [];
        lead = r.next;
        if (lead.custody === 'handler' && !tried.includes(lead.ownerUserId)) tried.push(lead.ownerUserId);
        steps.push(toStep(lead, r.events, fromName, type, now));
        if (type === 'critical') break;
      }
      return { steps, totalSeconds: steps.at(-1)?.atSeconds ?? 0 };
    },
    opts,
  );
}

// ── Lead sources + public web forms (F3.1) ──────────────────────────────

const formDto = (f: typeof webForms.$inferSelect): WebFormDto => ({
  id: f.id,
  slug: f.slug,
  title: f.title,
  teamId: f.teamId,
  isActive: f.isActive,
  version: f.version,
});

export async function intakeSettings(actor: Actor, opts: TxOptions = {}) {
  assertPermission(actor, 'routing.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const forms = await tx.select().from(webForms).orderBy(asc(webForms.createdAt));
      const sources = await teamsRepo.listLeadSources(tx);
      return {
        forms: forms.map(formDto),
        sources: sources.map((s) => ({ id: s.id, key: s.key, label: s.label, kind: s.kind })),
      };
    },
    opts,
  );
}

export async function updateWebForm(
  actor: Actor,
  id: string,
  input: { title?: string; slug?: string; teamId?: string; isActive?: boolean; version: number },
  opts: TxOptions = {},
): Promise<WebFormDto> {
  assertPermission(actor, 'routing.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const cur = (await tx.select().from(webForms).where(eq(webForms.id, id)).for('update'))[0];
      if (!cur) throw notFound();
      if (cur.version !== input.version) throw staleVersion(cur.version);
      if (input.teamId && !(await teamsRepo.getTeam(tx, input.teamId))) throw notFound();
      if (input.slug && input.slug !== cur.slug) {
        const taken = await tx.execute<{ id: string }>(
          sql`select id from public.web_forms where slug = ${input.slug} and id <> ${id}`,
        );
        if (taken.rows.length) throw new AppError('CONFLICT', { details: { field: 'slug' } });
      }
      const patch = {
        title: input.title ?? cur.title,
        slug: input.slug ?? cur.slug,
        teamId: input.teamId ?? cur.teamId,
        isActive: input.isActive ?? cur.isActive,
        version: cur.version + 1,
      };
      await tx.update(webForms).set(patch).where(eq(webForms.id, id));
      await auditAppend(tx, actor, {
        action: 'routing.rules_changed',
        targetType: 'web_form',
        targetId: id,
        before: { title: cur.title, slug: cur.slug, teamId: cur.teamId, isActive: cur.isActive },
        after: { title: patch.title, slug: patch.slug, teamId: patch.teamId, isActive: patch.isActive },
      });
      return formDto({ ...cur, ...patch });
    },
    opts,
  );
}

export const policiesService = { list, create, publish, simulate, intakeSettings, updateWebForm };
