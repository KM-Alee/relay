// Outbox due-work processor (01 §6, 04 §7). Claim → COMMIT → deliver (no tx) → record outcome in a
// new tx, fenced on the claim's attempt number. A crash anywhere after the claim leaves the row
// in_flight; once the lease (`locked_until`) expires the next tick reclaims it (Q5). Two ticks
// never hold the same row: the claim uses FOR UPDATE SKIP LOCKED (F3.8).
import { withSystemTx, withWorkspaceTx, type Tx } from '@relay/db';
import { log } from '../log';
import * as repo from '../repos/outbox';
import type { ClaimedJob } from '../repos/outbox';
import { defineProcessor, type DueWorkContext } from './due-work';
import { decideFailure, errorText, InvalidJobPayloadError, UnknownJobTypeError } from './policy';

/** Run `fn` in the row's own RLS context: its workspace, or the system context for NULL rows. */
function inRowContext<T>(workspaceId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return workspaceId ? withWorkspaceTx(workspaceId, fn) : withSystemTx(fn);
}

/** Claim a batch and COMMIT the claim (status in_flight, attempts+1, lease). */
export function claimOutboxBatch(ctx: DueWorkContext): Promise<ClaimedJob[]> {
  return withSystemTx((tx) =>
    repo.claim(tx, {
      limit: ctx.batchSize,
      leaseSeconds: ctx.leaseSeconds,
      types: ctx.scope.types,
      workspaceIds: ctx.scope.workspaceIds,
    }),
  );
}

export type DeliveryOutcome = 'done' | 'retry' | 'failed' | 'dead' | 'lost';

/** Run one claimed job's handler and record the outcome. Never throws for handler errors. */
export async function deliverJob(job: ClaimedJob, ctx: DueWorkContext): Promise<DeliveryOutcome> {
  let err: unknown = null;
  const handler = ctx.registry.get(job.type);
  try {
    if (!handler) throw new UnknownJobTypeError(job.type);
    const parsed = handler.payload.safeParse(job.payload);
    if (!parsed.success) throw new InvalidJobPayloadError(`invalid payload for ${job.type}`);
    await handler.handle(parsed.data, {
      jobId: job.id,
      workspaceId: job.workspaceId,
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
      now: ctx.clock.now(),
    });
  } catch (e) {
    err = e;
  }

  if (err === null) {
    const ok = await inRowContext(job.workspaceId, (tx) => repo.markDone(tx, job.id, job.attempt));
    if (!ok) log.warn('jobs.outbox.lease_lost', { jobId: job.id, type: job.type, attempt: job.attempt });
    return ok ? 'done' : 'lost';
  }

  const d = decideFailure({
    err,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    now: ctx.clock.now(),
    random: ctx.random,
  });
  const error = errorText(err);
  const ok = await inRowContext(job.workspaceId, (tx) =>
    d.status === 'pending'
      ? repo.markRetry(tx, job.id, job.attempt, {
          availableAt: d.availableAt,
          error,
          consumeAttempt: d.consumeAttempt,
        })
      : repo.markFinal(tx, job.id, job.attempt, { status: d.status, error }),
  );
  const meta = { jobId: job.id, type: job.type, attempt: job.attempt, status: d.status, error };
  if (d.status === 'pending') log.warn('jobs.outbox.retry', meta);
  else log.error('jobs.outbox.gave_up', meta);
  if (!ok) return 'lost';
  return d.status === 'pending' ? 'retry' : d.status;
}

export const outboxProcessor = defineProcessor({
  name: 'outbox',
  counter: 'outbox',
  async runBatch(ctx) {
    const jobs = await claimOutboxBatch(ctx);
    // Sequential: batches are small and bounded; each delivery has its own adapter timeout.
    for (const job of jobs) await deliverJob(job, ctx);
    return jobs.length;
  },
  nextDueAt(ctx) {
    return withSystemTx((tx) =>
      repo.nextDue(tx, { types: ctx.scope.types, workspaceIds: ctx.scope.workspaceIds }),
    );
  },
});
