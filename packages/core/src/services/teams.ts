// Teams + availability use cases (F3.2, F3.6; docs/03-lead-engine.md T5). Owner: Lane A.
import type { TeamDto } from '@relay/contracts/api/teams';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { teams as teamsTable } from '@relay/db/schema';
import { eq, sql } from 'drizzle-orm';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission, can } from '../auth/permissions';
import { uuidv7 } from '../ids';
import { reassignOnAbsence, type Availability } from '../domain/leads';
import { AppError, notFound, staleVersion } from '../errors';
import { enqueueWith } from '../jobs/outbox';
import { jobRegistry } from '../jobs/registry';
import { emit } from '../realtime/index';
import * as leadsRepo from '../repos/leads';
import * as teamsRepo from '../repos/teams';
import { dbNow } from './lead-engine';
import { runTransition } from './leads';

export async function list(actor: Actor, opts: TxOptions = {}): Promise<{ items: TeamDto[] }> {
  assertPermission(actor, 'team.availability.view');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const teams = await teamsRepo.listTeams(tx);
      const members = await teamsRepo.membersOf(
        tx,
        teams.map((t) => t.id),
      );
      return {
        items: teams.map((t) => ({
          id: t.id,
          name: t.name,
          isDefault: t.isDefault,
          managerUserId: t.managerUserId,
          backupUserId: t.backupUserId,
          routingMode: t.routingMode,
          defaultCapacity: t.defaultCapacity,
          ackWindowSeconds: t.ackWindowSeconds,
          routingRetrySeconds: t.routingRetrySeconds,
          idleSeconds: t.idleSeconds,
          idleRetriggerEnabled: t.idleRetriggerEnabled,
          escalationPolicyId: t.escalationPolicyId,
          version: t.version,
          members: members
            .filter((m) => m.teamId === t.id)
            .map((m) => ({
              userId: m.userId,
              name: m.name,
              availability: m.availability,
              isActive: m.isActive,
              position: m.position,
              openLeads: Number(m.open),
              capacity: m.capacity ?? t.defaultCapacity,
              version: m.version,
            })),
        })),
      };
    },
    opts,
  );
}

/** Kick T4 for the given teams (someone became available / capacity freed). */
export async function kickRetry(tx: Tx, teamIds: readonly string[], now: Date): Promise<void> {
  const sec = Math.floor(now.getTime() / 1000);
  for (const teamId of teamIds) {
    await enqueueWith(
      tx,
      { type: 'lead.retry_routing', payload: { teamId }, dedupeKey: `rr:${teamId}:${sec}` },
      jobRegistry,
    );
  }
}

/**
 * PATCH /api/v1/users/:id/availability (self, or team.availability.manage). In the SAME tx (03 T5):
 * on_leave / offline → every PENDING handler lead of the user is reassigned (eligible handler or
 * fallback custody); acknowledged leads stay (P0 banner). available → routing retry kicked.
 */
export async function setAvailability(
  actor: Actor,
  userId: string,
  availability: Availability,
  opts: TxOptions = {},
): Promise<{
  userId: string;
  availability: Availability;
  reassignedLeadIds: string[];
  keptAcknowledgedLeadIds: string[];
}> {
  if (userId !== actor.userId) assertPermission(actor, 'team.availability.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const cur = (
        await tx.execute<{ availability: Availability }>(
          sql`select availability from users where id = ${userId} and is_active for update`,
        )
      ).rows[0];
      if (!cur) throw notFound();
      const now = await dbNow(tx);
      const reassigned: string[] = [];
      const kept: string[] = [];
      if (cur.availability !== availability) {
        await tx.execute(
          sql`update users set availability = ${availability}::user_availability, version = version + 1 where id = ${userId}`,
        );
        await auditAppend(tx, actor, {
          action: 'user.availability_changed',
          targetType: 'user',
          targetId: userId,
          before: { availability: cur.availability },
          after: { availability },
        });
        if (availability === 'on_leave' || availability === 'offline') {
          for (const leadId of await leadsRepo.pendingHandlerLeadIds(tx, userId)) {
            const out = await runTransition(
              tx,
              leadId,
              (eng, lead) =>
                reassignOnAbsence(eng.ctx, lead, {
                  userId,
                  availability,
                  actor: { type: 'user', userId: actor.userId },
                }),
              { actor },
            );
            if (out?.result.ok && out.result.changed) reassigned.push(leadId);
          }
          const ackedRows = await tx.execute<{ id: string }>(
            sql`select id from leads where owner_user_id = ${userId} and status = 'open'
                  and custody = 'handler' and ack_status = 'acknowledged'`,
          );
          kept.push(...ackedRows.rows.map((r) => r.id));
        }
        if (availability === 'available') await kickRetry(tx, await teamsRepo.teamIdsOfUser(tx, userId), now);
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'team', ids: [userId] });
      }
      return { userId, availability, reassignedLeadIds: reassigned, keptAcknowledgedLeadIds: kept };
    },
    opts,
  );
}

export const teamsService = {
  list,
  create: createTeam,
  update: updateTeam,
  setAvailability,
  canManage: (a: Actor) => can(a, 'team.availability.manage'),
};

// ── Team admin (T-202, F3.2/F3.3/F3.5): create / edit teams, members, backup + manager, capacity ──

type TeamPatch = {
  name?: string;
  managerUserId?: string | null;
  backupUserId?: string | null;
  memberIds?: string[];
  defaultCapacity?: number;
  routingMode?: 'round_robin' | 'first_to_claim';
  routingRetrySeconds?: number;
  idleSeconds?: number;
  idleRetriggerEnabled?: boolean;
  escalationPolicyId?: string;
};

async function assertActiveUsers(tx: Tx, ids: readonly string[]): Promise<void> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const res = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from users where is_active and id = any(${`{${uniq.join(',')}}`}::uuid[])`,
  );
  if (Number(res.rows[0]?.n) !== uniq.length)
    throw new AppError('VALIDATION_FAILED', { details: { field: 'users', reason: 'unknown_user' } });
}

async function replaceMembers(tx: Tx, workspaceId: string, teamId: string, ids: readonly string[]) {
  await tx.execute(sql`delete from team_members where team_id = ${teamId}`);
  let pos = 0;
  for (const userId of [...new Set(ids)]) {
    pos += 1;
    await tx.execute(
      sql`insert into team_members (workspace_id, team_id, user_id, position) values (${workspaceId}, ${teamId}, ${userId}, ${pos})`,
    );
  }
}

async function oneTeamDto(tx: Tx, teamId: string): Promise<TeamDto> {
  const rows = (await teamsRepo.listTeams(tx)).filter((t) => t.id === teamId);
  const members = await teamsRepo.membersOf(tx, [teamId]);
  const t = rows[0];
  if (!t) throw notFound();
  return {
    id: t.id,
    name: t.name,
    isDefault: t.isDefault,
    managerUserId: t.managerUserId,
    backupUserId: t.backupUserId,
    routingMode: t.routingMode,
    defaultCapacity: t.defaultCapacity,
    ackWindowSeconds: t.ackWindowSeconds,
    routingRetrySeconds: t.routingRetrySeconds,
    idleSeconds: t.idleSeconds,
    idleRetriggerEnabled: t.idleRetriggerEnabled,
    escalationPolicyId: t.escalationPolicyId,
    version: t.version,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.name,
      availability: m.availability,
      isActive: m.isActive,
      position: m.position,
      openLeads: Number(m.open),
      capacity: m.capacity ?? t.defaultCapacity,
      version: m.version,
    })),
  };
}

export async function createTeam(
  actor: Actor,
  input: {
    name: string;
    managerUserId?: string | null;
    backupUserId?: string | null;
    memberIds?: string[];
    defaultCapacity?: number;
  },
  opts: TxOptions = {},
): Promise<TeamDto> {
  assertPermission(actor, 'routing.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const base = await teamsRepo.defaultTeam(tx);
      if (!base) throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'no_default_team' } });
      await assertActiveUsers(tx, [
        ...(input.memberIds ?? []),
        ...(input.managerUserId ? [input.managerUserId] : []),
        ...(input.backupUserId ? [input.backupUserId] : []),
      ]);
      const id = uuidv7();
      await teamsRepo.insertTeam(tx, {
        id,
        workspaceId: actor.workspaceId,
        name: input.name,
        managerUserId: input.managerUserId ?? null,
        backupUserId: input.backupUserId ?? null,
        defaultCapacity: input.defaultCapacity ?? base.defaultCapacity,
        ackWindowSeconds: base.ackWindowSeconds,
        urgentAckWindowSeconds: base.urgentAckWindowSeconds,
        routingRetrySeconds: base.routingRetrySeconds,
        idleSeconds: base.idleSeconds,
        escalationPolicyId: base.escalationPolicyId,
      });
      await replaceMembers(tx, actor.workspaceId, id, input.memberIds ?? []);
      await auditAppend(tx, actor, {
        action: 'team.created',
        targetType: 'team',
        targetId: id,
        before: null,
        after: { name: input.name, memberIds: input.memberIds ?? [] },
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team', ids: [id] });
      return oneTeamDto(tx, id);
    },
    opts,
  );
}

export async function updateTeam(
  actor: Actor,
  teamId: string,
  input: TeamPatch & { version: number },
  opts: TxOptions = {},
): Promise<TeamDto> {
  assertPermission(actor, 'routing.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const cur = await teamsRepo.getTeam(tx, teamId, true);
      if (!cur) throw notFound();
      if (cur.version !== input.version) throw staleVersion(cur.version);
      await assertActiveUsers(tx, [
        ...(input.memberIds ?? []),
        ...(input.managerUserId ? [input.managerUserId] : []),
        ...(input.backupUserId ? [input.backupUserId] : []),
      ]);
      const patch: Record<string, unknown> = {};
      const keys = [
        'name',
        'managerUserId',
        'backupUserId',
        'defaultCapacity',
        'routingMode',
        'routingRetrySeconds',
        'idleSeconds',
        'idleRetriggerEnabled',
      ] as const;
      for (const k of keys) if (input[k] !== undefined) patch[k] = input[k];
      if (input.escalationPolicyId && input.escalationPolicyId !== cur.escalationPolicyId) {
        const first = (
          await tx.execute<{ t: number }>(
            sql`select timeout_seconds as t from escalation_levels where policy_id = ${input.escalationPolicyId} order by position limit 1`,
          )
        ).rows[0];
        if (!first) throw notFound();
        patch.escalationPolicyId = input.escalationPolicyId;
        patch.ackWindowSeconds = Number(first.t);
      }
      await tx
        .update(teamsTable)
        .set({ ...patch, version: cur.version + 1 })
        .where(eq(teamsTable.id, teamId));
      if (input.memberIds) await replaceMembers(tx, actor.workspaceId, teamId, input.memberIds);
      await auditAppend(tx, actor, {
        action: 'routing.rules_changed',
        targetType: 'team',
        targetId: teamId,
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, (cur as Record<string, unknown>)[k]])),
        after: { ...patch, ...(input.memberIds ? { memberIds: input.memberIds } : {}) },
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team', ids: [teamId] });
      return oneTeamDto(tx, teamId);
    },
    opts,
  );
}
