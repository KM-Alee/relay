// Wake-up scheduling (docs/03-lead-engine.md §6, 01 §6, ADR-0002). Owner: Lane A (T-008).
//
//   ensureWakeBy(tx, at)   IN a transaction (lead transitions): writes a `wake.schedule` outbox row
//                          (dedupe `wake:<epochSecond>`). No external call. Skipped when an earlier
//                          wake is already pending.
//   scheduleWake(at)       OUTSIDE any transaction (the wake.schedule handler, the tick tail):
//                          tx1 reserve scheduler_state (row lock, only if earlier / none / stale)
//                          → commit → QStash publish → tx2 record the message id
//                          (publish failed → tx2 restores the previous state, so a retry can win).
//
// One wake per NEXT deadline (not per lead) keeps us inside QStash's free daily cap. Wakes are
// rounded UP to whole seconds so the dedupe id is stable; QStash itself dedupes by that id.
import { withSystemTx, type Tx } from '@relay/db';
import { systemClock, type Clock } from '../clock';
import type { WakeScheduler } from '../integrations/qstash/types';
import { log } from '../log';
import * as outboxRepo from '../repos/outbox';
import * as stateRepo from '../repos/scheduler-state';

export const WAKE_JOB_TYPE = 'wake.schedule';
export const WAKE_MAX_ATTEMPTS = 3;
/** A deadline closer than this needs no wake: the current after() kick / tick handles it. */
export const MIN_WAKE_LEAD_MS = 1_000;
/** QStash caps message delay (verify per plan); a clamped wake simply re-schedules when it fires. */
export const MAX_WAKE_DELAY_MS = 6 * 24 * 3600_000;

export const ceilToSecond = (d: Date) => new Date(Math.ceil(d.getTime() / 1000) * 1000);
export const wakeDedupeId = (at: Date) => `wake:${Math.floor(at.getTime() / 1000)}`;

/**
 * Make sure a tick will run by `at`. Call it in the SAME transaction that set a deadline.
 * Cheap: one read of scheduler_state, and at most one outbox insert.
 */
export async function ensureWakeBy(tx: Tx, at: Date): Promise<{ enqueued: boolean }> {
  const sec = ceilToSecond(at);
  if (!(await stateRepo.needsWake(tx, sec))) return { enqueued: false };
  const r = await outboxRepo.insert(tx, {
    type: WAKE_JOB_TYPE,
    payload: { at: sec.toISOString() },
    dedupeKey: wakeDedupeId(sec),
    maxAttempts: WAKE_MAX_ATTEMPTS,
  });
  return { enqueued: !r.deduped };
}

export type WakeOutcome = 'scheduled' | 'kept' | 'disabled' | 'due';

export interface ScheduleWakeDeps {
  scheduler: WakeScheduler;
  clock?: Clock;
}

/**
 * Publish a QStash wake for `at` unless an earlier (still future) wake is already scheduled.
 * Throws if the publish fails (after releasing the reservation): the outbox retries it.
 */
export async function scheduleWake(
  at: Date,
  deps: ScheduleWakeDeps,
): Promise<{ outcome: WakeOutcome; at: Date; messageId?: string }> {
  const now = (deps.clock ?? systemClock).now();
  let sec = ceilToSecond(at);
  if (!deps.scheduler.enabled) return { outcome: 'disabled', at: sec };
  if (sec.getTime() - now.getTime() < MIN_WAKE_LEAD_MS) return { outcome: 'due', at: sec };
  if (sec.getTime() - now.getTime() > MAX_WAKE_DELAY_MS)
    sec = ceilToSecond(new Date(now.getTime() + MAX_WAKE_DELAY_MS));

  const { reserved, previous } = await withSystemTx((tx) => stateRepo.reserve(tx, sec));
  if (!reserved) return { outcome: 'kept', at: previous.nextWakeAt ?? sec };

  let messageId: string;
  try {
    ({ messageId } = await deps.scheduler.scheduleAt(sec, wakeDedupeId(sec)));
  } catch (err) {
    await withSystemTx((tx) => stateRepo.release(tx, sec, previous)).catch((e: unknown) =>
      log.error('jobs.wake.release_failed', { err: e }),
    );
    throw err;
  }
  await withSystemTx((tx) => stateRepo.recordMessage(tx, sec, messageId));
  return { outcome: 'scheduled', at: sec, messageId };
}

/**
 * Judge Console "lose the doorbell" (F10.1, Q5): cancel the scheduled wake at the provider and
 * forget it. The nudge / backstop must still process the deadline.
 */
export async function cancelScheduledWake(deps: {
  scheduler: WakeScheduler;
}): Promise<{ messageId: string | null }> {
  const prev = await withSystemTx((tx) => stateRepo.clear(tx));
  if (prev.messageId && deps.scheduler.enabled) await deps.scheduler.cancel(prev.messageId);
  return { messageId: prev.messageId };
}
