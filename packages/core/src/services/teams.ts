// Teams + availability use cases (F3.2, F3.6; docs/03-lead-engine.md T5). Owner: Lane A.
import type { TeamDto } from '@relay/contracts/api/teams';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { sql } from 'drizzle-orm';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission, can } from '../auth/permissions';
import { reassignOnAbsence, type Availability } from '../domain/leads';
import { notFound } from '../errors';
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
  setAvailability,
  canManage: (a: Actor) => can(a, 'team.availability.manage'),
};
