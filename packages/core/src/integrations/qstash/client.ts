// Real QStash adapter (@upstash/qstash, verified against SDK 2.12.0 typings, 2026-10-18):
//   Client({ token, baseUrl })            baseUrl = QSTASH_URL (region-specific endpoint)
//   publishJSON({ url, body, notBefore, deduplicationId, retries, label }) → { messageId }
//   messages.cancel(messageId)
//   schedules.create({ scheduleId, destination, cron, method, body, headers, retries }) (upsert by id)
// Never called inside a DB transaction (AGENTS.md rule 3): only from the outbox / tick tail.
import { Client } from '@upstash/qstash';
import type { TickBody, WakeScheduler } from './types';

export interface QStashClientConfig {
  token: string;
  /** Region-specific API URL (QSTASH_URL). Default: the SDK default (https://qstash.upstash.io). */
  baseUrl?: string;
}

function client(cfg: QStashClientConfig): Client {
  // enableTelemetry:false: no SDK/platform headers sent to Upstash (no need, zero-cost hygiene).
  return new Client({ token: cfg.token, baseUrl: cfg.baseUrl, enableTelemetry: false });
}

export function createQStashWakeScheduler(cfg: QStashClientConfig & { tickUrl: string }): WakeScheduler {
  const c = client(cfg);
  return {
    kind: 'qstash',
    enabled: true,
    async scheduleAt(at, dedupeId) {
      const body: TickBody = { trigger: 'qstash', at: at.toISOString() };
      const res = await c.publishJSON({
        url: cfg.tickUrl,
        method: 'POST',
        body,
        notBefore: Math.floor(at.getTime() / 1000),
        // QStash rejects ':' in deduplication ids ("DeduplicationId cannot contain ':'").
        deduplicationId: dedupeId.replace(/[^A-Za-z0-9_.-]/g, '-'),
        // One retry covers a cold-start blip; more would only burn the daily cap (backstop exists).
        retries: 1,
        label: 'relay-wake',
      });
      return { messageId: res.messageId };
    },
    async cancel(messageId) {
      await c.messages.cancel(messageId);
    },
  };
}

export const BACKSTOP_SCHEDULE_ID = 'relay-tick-backstop';

/** Create or update (same scheduleId) the cron backstop that POSTs the tick endpoint. */
export async function upsertBackstopSchedule(
  cfg: QStashClientConfig & { tickUrl: string; cron: string; scheduleId?: string },
): Promise<{ scheduleId: string }> {
  const body: TickBody = { trigger: 'cron' };
  return client(cfg).schedules.create({
    scheduleId: cfg.scheduleId ?? BACKSTOP_SCHEDULE_ID,
    destination: cfg.tickUrl,
    cron: cfg.cron,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    retries: 0, // the next run is the retry
    label: 'relay-backstop',
  });
}
