// SEAMS to other lanes' APIs: enqueueJob -> Lane A's outbox repo; appendAudit -> Lane B's audit.append().
import type { Tx } from '@relay/db';
import * as audit from '../audit';
import type { AuditEntry } from '../audit';
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

export type AuditInput = AuditEntry;

/** Thin wrapper over the real hash-chained `audit.append()` (T-007); kept so Lane C call sites stay short. */
export async function appendAudit(tx: Tx, actor: AuditActorLike, e: AuditInput): Promise<void> {
  await audit.append(tx, actor, e);
}
