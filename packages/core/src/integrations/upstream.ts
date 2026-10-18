// SEAMS to other lanes' APIs. enqueueJob -> Lane A's outbox repo (merged). appendAudit is a raw-SQL
// equivalent of Lane B's `audit.append()` (T-007, not on main yet; same table, the chain is a DB trigger).
// TODO(T-007): swap appendAudit's body for audit.append() once Lane B is merged.
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../auth/actor';
import { DEFAULT_MAX_ATTEMPTS } from '../jobs/policy';
import * as outboxRepo from '../repos/outbox';

export interface EnqueueInput {
  type: string;
  payload: unknown;
  dedupeKey?: string;
  availableAt?: Date;
  maxAttempts?: number;
}

/**
 * Insert an outbox row in the caller's tx (Lane A's repo; workspace comes from the tx context).
 * Goes through the repo rather than the typed enqueue() because the job registry imports the Slack
 * handlers, which import this module (a cycle). The payload is validated by the handler at delivery.
 */
export async function enqueueJob(
  tx: Tx,
  job: EnqueueInput,
): Promise<{ id: string | null; deduped: boolean }> {
  return outboxRepo.insert(tx, {
    type: job.type,
    payload: job.payload,
    dedupeKey: job.dedupeKey,
    availableAt: job.availableAt,
    maxAttempts: job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  });
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
