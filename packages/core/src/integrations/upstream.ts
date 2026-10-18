// SEAMS to other lanes' APIs that are not on main yet (Lane A outbox T-008, Lane B audit T-007).
// They are thin raw-SQL equivalents of `enqueue()` (core/jobs/outbox.ts) and `audit.append()`
// (core/audit), writing the SAME tables/columns as the real ones. TODO: once both lanes are merged,
// replace the bodies with calls to the real functions (one-line swaps) and delete the SQL here.
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../auth/actor';

export interface EnqueueInput {
  type: string;
  payload: unknown;
  dedupeKey?: string;
  availableAt?: Date;
  maxAttempts?: number;
}

/** Insert an outbox row in the caller's tx; workspace comes from the tx context (NULL in a system tx). */
export async function enqueueJob(
  tx: Tx,
  job: EnqueueInput,
): Promise<{ id: string | null; deduped: boolean }> {
  const res = await tx.execute<{ id: string }>(sql`
    insert into outbox (workspace_id, type, payload, dedupe_key, available_at, max_attempts)
    values (nullif(current_setting('app.workspace_id', true), '')::uuid, ${job.type},
            ${JSON.stringify(job.payload)}::jsonb, ${job.dedupeKey ?? null},
            ${(job.availableAt ?? new Date()).toISOString()}::timestamptz, ${job.maxAttempts ?? 6})
    on conflict (dedupe_key) do nothing
    returning id`);
  const row = res.rows[0];
  return { id: row?.id ?? null, deduped: !row };
}

export type AuditActorLike = Actor | { type: 'system'; workspaceId: string };

export interface AuditInput {
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

export async function appendAudit(tx: Tx, actor: AuditActorLike, e: AuditInput): Promise<void> {
  const system = 'type' in actor;
  await tx.execute(sql`
    insert into audit_events (workspace_id, actor_type, actor_user_id, action, target_type, target_id, before, after, meta)
    values (${actor.workspaceId}, ${system ? 'system' : 'user'}::audit_actor_type, ${system ? null : actor.userId},
            ${e.action}, ${e.targetType}, ${e.targetId ?? null}, ${json(e.before)}::jsonb,
            ${json(e.after)}::jsonb, ${json(e.meta)}::jsonb)`);
}
