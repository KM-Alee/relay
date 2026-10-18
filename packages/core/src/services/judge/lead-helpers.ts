// Shared helpers for the lead Judge scenarios (F3). Lane A. Throwaway leads are tagged `[judge]` and closed.
import { withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../../auth/actor';
import { intakeInTx } from '../leads';
import { nonce } from './helpers';

export type UserAvail = {
  id: string;
  availability: string;
};

export async function activeUsers(workspaceId: string): Promise<UserAvail[]> {
  return withWorkspaceTx(
    workspaceId,
    async (tx) =>
      (
        await tx.execute<UserAvail>(
          sql`select id, availability::text as availability from users where is_active order by created_at`,
        )
      ).rows,
  );
}

/** Direct availability write (no reassignment side effects); used only to stage and restore. */
export async function setAvail(workspaceId: string, id: string, a: string): Promise<void> {
  await withWorkspaceTx(workspaceId, (tx) =>
    tx.execute(
      sql`update users set availability = ${a}::user_availability, version = version + 1 where id = ${id}::uuid`,
    ),
  );
}

export async function restoreAvail(workspaceId: string, users: UserAvail[]): Promise<void> {
  for (const u of users) await setAvail(workspaceId, u.id, u.availability).catch(() => undefined);
}

export async function judgeIntake(actor: Actor, label: string) {
  const tag = nonce();
  return withWorkspaceTx(actor.workspaceId, (tx) =>
    intakeInTx(tx, {
      workspaceId: actor.workspaceId,
      contact: { name: `[judge] ${label} ${tag}` },
      message: '[judge] throwaway lead',
      source: { kind: 'manual', label: 'Judge Console' },
      actor,
    }),
  );
}

export async function closeJudgeLead(workspaceId: string, leadId: string): Promise<void> {
  await withWorkspaceTx(workspaceId, (tx) =>
    tx.execute(sql`update leads set status = 'closed', closed_reason = 'judge_cleanup', escalate_at = null,
      routing_retry_at = null, idle_check_at = null, version = version + 1 where id = ${leadId}::uuid`),
  ).catch(() => undefined);
}

export async function leadRow(workspaceId: string, leadId: string) {
  return withWorkspaceTx(
    workspaceId,
    async (tx) =>
      (
        await tx.execute<{
          owner_user_id: string;
          custody: string;
          awaiting_reason: string | null;
          escalation_count: number;
        }>(
          sql`select owner_user_id, custody, awaiting_reason, escalation_count from leads where id = ${leadId}::uuid`,
        )
      ).rows[0],
  );
}
