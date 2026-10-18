// FakeWakeScheduler: records calls (tests, INTEGRATIONS_FAKE=1, Judge Console). Never in production.
import type { WakeScheduler } from './types';

export interface FakeWakeScheduler extends WakeScheduler {
  readonly scheduled: Array<{ at: Date; dedupeId: string; messageId: string }>;
  readonly cancelled: string[];
  /** Make the next `n` scheduleAt calls throw (outage simulation). */
  failNext(n?: number): void;
  reset(): void;
}

export function createFakeWakeScheduler(): FakeWakeScheduler {
  const scheduled: FakeWakeScheduler['scheduled'] = [];
  const cancelled: string[] = [];
  let failures = 0;
  let seq = 0;
  return {
    kind: 'fake',
    enabled: true,
    scheduled,
    cancelled,
    async scheduleAt(at, dedupeId) {
      if (failures > 0) {
        failures -= 1;
        throw Object.assign(new Error('fake qstash outage'), { kind: 'temporary' });
      }
      // Same dedupe id → same message (QStash accepts but does not enqueue duplicates).
      const dup = scheduled.find((s) => s.dedupeId === dedupeId);
      if (dup) return { messageId: dup.messageId };
      const messageId = `fake_msg_${++seq}`;
      scheduled.push({ at, dedupeId, messageId });
      return { messageId };
    },
    async cancel(messageId) {
      cancelled.push(messageId);
    },
    failNext(n = 1) {
      failures = n;
    },
    reset() {
      scheduled.length = 0;
      cancelled.length = 0;
      failures = 0;
    },
  };
}

/** No QStash configured (or unreachable localhost URL): wakes are skipped; ticks still work. */
export const disabledWakeScheduler: WakeScheduler = {
  kind: 'disabled',
  enabled: false,
  async scheduleAt() {
    throw new Error('wake scheduler disabled');
  },
  async cancel() {
    /* nothing scheduled */
  },
};
