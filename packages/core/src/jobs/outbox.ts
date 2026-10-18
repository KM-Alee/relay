// Transactional outbox: enqueue side effects IN the caller's transaction (AGENTS.md rule 3).
// The row commits atomically with the state change; delivery happens in runDueWork().
//
//   await withWorkspaceTx(ws, async (tx) => {
//     ...state change...
//     await enqueue(tx, { type: 'slack.send', payload, dedupeKey: `sl:${purpose}:${leadId}:${v}:${userId}` });
//   });
//   kickDueWork();   // apps/web/lib/jobs/kick.ts: deliver within milliseconds via after()
//
// workspace_id is taken from the transaction (withWorkspaceTx → that workspace; withSystemTx → NULL).
import type { Tx } from '@relay/db';
import { AppError } from '../errors';
import * as repo from '../repos/outbox';
import { DEFAULT_MAX_ATTEMPTS } from './policy';
import { jobRegistry, type JobPayload, type JobRegistry, type JobType } from './registry';

export interface EnqueueOptions {
  /** Unique across the outbox (04 §7 key formats). A duplicate is silently skipped. */
  dedupeKey?: string;
  /** Deliver no earlier than this (default: now). Business deadlines: use clock.deadline(). */
  availableAt?: Date;
  /** Override the handler's default attempts. */
  maxAttempts?: number;
}

export interface EnqueueResult {
  id: string | null;
  /** true → a row with the same dedupe key already existed; nothing was inserted. */
  deduped: boolean;
}

/** Enqueue a registered job type with a type-checked payload. */
export async function enqueue<T extends JobType>(
  tx: Tx,
  job: { type: T; payload: JobPayload<T> } & EnqueueOptions,
): Promise<EnqueueResult> {
  return enqueueWith(tx, job, jobRegistry);
}

/**
 * Untyped variant over an explicit registry (tests, Judge Console). The payload is validated
 * against the handler's schema NOW, so a bad payload fails in the caller's request, not later.
 */
export async function enqueueWith(
  tx: Tx,
  job: { type: string; payload: unknown } & EnqueueOptions,
  registry: JobRegistry,
): Promise<EnqueueResult> {
  const h = registry.get(job.type);
  if (!h) throw new AppError('INTERNAL', { message: `enqueue: unknown job type ${job.type}` });
  const parsed = h.payload.safeParse(job.payload);
  if (!parsed.success) {
    throw new AppError('INTERNAL', {
      message: `enqueue: invalid payload for ${job.type}`,
      details: { type: job.type, issues: parsed.error.issues.map((i) => i.path.join('.')) },
    });
  }
  return repo.insert(tx, {
    type: job.type,
    // Store the INPUT (not the parsed output) so the handler's parse at delivery is the same parse.
    payload: job.payload,
    dedupeKey: job.dedupeKey,
    availableAt: job.availableAt,
    maxAttempts: job.maxAttempts ?? h.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
  });
}
