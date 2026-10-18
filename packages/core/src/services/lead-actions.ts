// Lead actions beyond intake/ack (docs/03-lead-engine.md T6, T7, T11, §7). Owner: Lane A.
//  - T7 manual reassign (eligible targets; ineligible only with override + reason, audited) + Take over
//  - recovery queue (R1–R5 with one recommended action per row, F3.7)
//  - T6 deactivation transfer + fallback-owner guard + join → default team (F1.8 via user-lifecycle hooks)
//  - T11 close when an opportunity enters a won/lost stage
// Every transition goes through runTransition (FOR UPDATE + guard + versioned update + effects).
import type {
  RecoveryItem,
  RecoveryReason,
  ReassignInput,
  ReassignTargetsResponse,
} from '@relay/contracts/api/leads';
import { leads } from '@relay/db/schema';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import { systemActor } from '../audit/index';
import type { Actor } from '../auth/actor';
import type { UserLifecycleContext } from '../auth/user-lifecycle';
import { assertPermission, can } from '../auth/permissions';
import { foundOr404, leadScopeSql } from '../auth/visibility';
import {
  REJECTION_ERROR,
  canDeactivateUser,
  closeLead,
  ineligibilityReason,
  manualReassign,
  transferOnDeactivation,
  type ClosedReason,
  type Rejected,
} from '../domain/leads';
import { AppError, notFound } from '../errors';
import * as leadsRepo from '../repos/leads';
import * as recoveryRepo from '../repos/recovery-queue';
import * as teamsRepo from '../repos/teams';
import { dbNow, loadEngine } from './lead-engine';
import { get as getLead, runTransition } from './leads';

const rejection = (r: Rejected) =>
  new AppError(REJECTION_ERROR[r.code], {
    details: { reason: r.code, currentOwnerUserId: r.currentOwnerUserId, ...(r.detail ?? {}) },
  });

// ── T7 manual reassign + Take over ──────────────────────────────────────

/** GET /api/v1/leads/:id/reassign-targets: everyone the manager may pick, eligibility explained (F3.11). */
export async function reassignTargets(
  actor: Actor,
  leadId: string,
  opts: TxOptions = {},
): Promise<ReassignTargetsResponse> {
  assertPermission(actor, 'leads.reassign');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const row = foundOr404(await leadsRepo.getLead(tx, leadId, leadScopeSql(actor, leads.ownerUserId)));
      const eng = await loadEngine(tx, row.workspaceId, row.teamId, await dbNow(tx));
      const all = await tx.execute<{ id: string }>(sql`select id from users where is_active order by name`);
      const others = all.rows.map((r) => r.id).filter((id) => !eng.ctx.people.some((p) => p.userId === id));
      const people = others.length
        ? [...eng.ctx.people, ...(await teamsRepo.loadPeople(tx, row.teamId, others))]
        : eng.ctx.people;
      const seen = new Set<string>();
      const items = people
        .filter((p) => p.isActive && !seen.has(p.userId) && seen.add(p.userId))
        .map((p) => {
          const why = ineligibilityReason(p, {
            team: eng.ctx.team,
            flags: eng.ctx.flags,
            requireMembership: true,
          });
          return {
            userId: p.userId,
            name: p.name,
            availability: p.availability,
            openLeads: p.openHandlerCount,
            capacity: eng.ctx.team.defaultCapacity,
            eligible: !why,
            ineligibleReason: why,
            isCurrentOwner: p.userId === row.ownerUserId,
          };
        })
        .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name));
      return { items };
    },
    opts,
  );
}

/** POST /api/v1/leads/:id/reassign (leads.reassign). Fresh window, pending ack, audited (03 T7, OQ-2). */
export async function reassign(actor: Actor, leadId: string, input: ReassignInput, opts: TxOptions = {}) {
  assertPermission(actor, 'leads.reassign');
  await withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      foundOr404(await leadsRepo.getLead(tx, leadId, leadScopeSql(actor, leads.ownerUserId)));
      const out = await runTransition(
        tx,
        leadId,
        (eng, lead) => {
          if (input.version !== undefined && input.version !== lead.version)
            return { ok: false, code: 'STALE_VERSION', currentOwnerUserId: lead.ownerUserId, events: [] };
          return manualReassign(eng.ctx, lead, {
            actorUserId: actor.userId,
            toUserId: input.toUserId,
            override: input.override ? { reason: input.overrideReason ?? '' } : undefined,
          });
        },
        { actor, extraPeople: [input.toUserId] },
      );
      if (!out) throw notFound();
      if (!out.result.ok) throw rejection(out.result);
    },
    opts,
  );
  return getLead(actor, leadId, opts);
}

/** POST /api/v1/leads/:id/take-over: the fallback custodian becomes the handler (03 §11 Q3). */
export async function takeOver(actor: Actor, leadId: string, opts: TxOptions = {}) {
  await withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      foundOr404(await leadsRepo.getLead(tx, leadId, leadScopeSql(actor, leads.ownerUserId)));
      const out = await runTransition(
        tx,
        leadId,
        (eng, lead) =>
          manualReassign(eng.ctx, lead, {
            actorUserId: actor.userId,
            toUserId: actor.userId,
            takeOver: true,
          }),
        { actor, extraPeople: [actor.userId] },
      );
      if (!out) throw notFound();
      if (!out.result.ok) throw rejection(out.result);
    },
    opts,
  );
  return getLead(actor, leadId, opts);
}

// ── recovery queue (F3.7) ───────────────────────────────────────────────

/** GET /api/v1/recovery: R1–R5 with reasons, time since window ended, one recommended action. */
export async function recoveryList(
  actor: Actor,
  q: { reason?: RecoveryReason; mine?: boolean; limit?: number },
  opts: TxOptions = {},
): Promise<{ items: RecoveryItem[]; total: number; now: string }> {
  assertPermission(actor, 'leads.recovery.view');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const scope = leadScopeSql(actor, sql.raw('l.owner_user_id'));
      const rows = await recoveryRepo.listRecovery(tx, {
        scope,
        reason: q.reason,
        ownerUserId: q.mine ? actor.userId : undefined,
        limit: q.limit ?? 100,
      });
      const now = await dbNow(tx);
      const canReassign = can(actor, 'leads.reassign');
      // Is the viewer an eligible handler for each team (Take over, 03 §11 Q3)?
      const eligibleIn = new Map<string, boolean>();
      for (const teamId of new Set(rows.filter((r) => r.ownerUserId === actor.userId).map((r) => r.teamId))) {
        const eng = await loadEngine(tx, actor.workspaceId, teamId, now, [actor.userId]);
        const me = eng.ctx.people.find((p) => p.userId === actor.userId);
        eligibleIn.set(
          teamId,
          !!me &&
            !ineligibilityReason(me, { team: eng.ctx.team, flags: eng.ctx.flags, requireMembership: false }),
        );
      }
      const items = rows.map((r): RecoveryItem => {
        const action: RecoveryItem['action'] =
          r.custody === 'fallback' && r.ownerUserId === actor.userId && eligibleIn.get(r.teamId)
            ? 'take_over'
            : canReassign && r.ownerUserId !== actor.userId
              ? 'reassign'
              : 'open';
        return {
          id: r.id,
          contactId: r.contactId,
          contactName: r.contactName,
          sourceLabel: r.sourceLabel,
          reasons: r.reasons,
          owner: { id: r.ownerUserId, name: r.ownerName },
          custody: r.custody,
          awaitingReason: r.awaitingReason as RecoveryItem['awaitingReason'],
          ackStatus: r.ackStatus,
          isUrgent: r.isUrgent,
          isCritical: r.isCritical,
          escalationCount: r.escalationCount,
          overdueAttemptCount: r.overdueAttemptCount,
          windowEndedAt:
            r.ackStatus === 'pending' && r.baseWindowEndsAt < now ? r.baseWindowEndsAt.toISOString() : null,
          lastActionAt: r.lastActionAt.toISOString(),
          firstAssignedAt: r.firstAssignedAt.toISOString(),
          version: r.version,
          action,
        };
      });
      return { items, total: items.length, now: now.toISOString() };
    },
    opts,
  );
}

// ── T6 deactivation (F1.8) + join ───────────────────────────────────────

/** guardUserDeactivation: the workspace Owner / a configured team manager (fallback) can't go. */
export async function guardFallbackOwner(tx: Tx, c: UserLifecycleContext): Promise<void> {
  const ws = await teamsRepo.workspaceRouting(tx, c.workspaceId);
  const teams = await teamsRepo.listTeams(tx);
  const verdict = canDeactivateUser({
    userId: c.userId,
    workspaceOwnerUserId: ws?.ownerUserId ?? '',
    teams: teams.map((t) => ({ id: t.id, managerUserId: t.managerUserId })),
  });
  if (!verdict.ok)
    throw new AppError('BUSINESS_RULE_VIOLATION', {
      details: { reason: `fallback_owner_${verdict.reason}`, teamIds: verdict.teamIds },
    });
}

/** onUserDeactivated: every open lead they own moves (pending, acknowledged, fallback custody). */
export async function transferLeadsOnDeactivation(tx: Tx, c: UserLifecycleContext): Promise<void> {
  const ids = await tx.execute<{ id: string }>(
    sql`select id from leads where owner_user_id = ${c.userId}::uuid and status = 'open' order by first_assigned_at`,
  );
  for (const { id } of ids.rows) {
    const out = await runTransition(
      tx,
      id,
      (eng, lead) =>
        transferOnDeactivation(eng.ctx, lead, {
          userId: c.userId,
          actor: { type: 'user', userId: c.actor.userId },
        }),
      { actor: c.actor },
    );
    if (out && !out.result.ok && out.result.code !== 'NOT_OWNER' && out.result.code !== 'LEAD_CLOSED')
      throw rejection(out.result);
  }
  // A deactivated user stays a (skipped, `inactive`) member: history and positions are kept.
}

/** onUserJoined: an accepted invite joins the default team's rotation (F3.3). */
export async function addToDefaultTeam(tx: Tx, c: UserLifecycleContext): Promise<void> {
  const team = await teamsRepo.defaultTeam(tx);
  if (team) await teamsRepo.addMember(tx, { workspaceId: c.workspaceId, teamId: team.id, userId: c.userId });
}

// ── T11 close ───────────────────────────────────────────────────────────

/** Close the contact's open lead (won/lost stage, disqualified). In the caller's tx; kicks retry. */
export async function closeOpenLeadForContactInTx(
  tx: Tx,
  workspaceId: string,
  contactId: string,
  reason: ClosedReason,
  actor: Actor | null,
): Promise<boolean> {
  const open = await tx.execute<{ id: string }>(
    sql`select id from leads where contact_id = ${contactId}::uuid and status = 'open' limit 1`,
  );
  const id = open.rows[0]?.id;
  if (!id) return false;
  const out = await runTransition(
    tx,
    id,
    (eng, lead) =>
      closeLead(eng.ctx, lead, {
        reason,
        actor: actor ? { type: 'user', userId: actor.userId } : { type: 'system' },
      }),
    { actor: actor ?? systemActor(workspaceId) },
  );
  return !!out?.result.ok;
}

export const leadActionsService = { reassignTargets, reassign, takeOver, recoveryList };
