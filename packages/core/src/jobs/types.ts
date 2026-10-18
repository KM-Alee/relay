// Outbox job handler contract (docs/01-architecture.md §6, docs/04-integrations.md §7). Owner: Lane A (T-008).
// A handler declares its `type` (`<area>.<verb>`, 10 §2), a Zod payload schema, and `handle()`.
// Handlers run OUTSIDE the enqueueing transaction; external calls are allowed here (rule 3), and
// must be idempotent (at-least-once delivery: a lease expiry re-runs a handler whose outcome was
// never recorded). Use `ctx.jobId` / the row's dedupe key as the provider idempotency key, and
// re-read state first (exit if the work is already done).
//
// Throwing:
//   any error                → retried with backoff (2^n × 2 s, cap 10 min, ±20 %), then 'dead'
//   PermanentJobError        → 'failed' now (also ProviderError{kind:'permanent'|'auth'})
//   DeferJobError(delayMs)   → retried later WITHOUT consuming an attempt (breaker open)
// (classes in ./policy.ts)
import type { z } from 'zod';

export interface JobContext {
  /** Outbox row id: use as idempotency key towards providers. */
  jobId: string;
  workspaceId: string | null;
  /** 1-based attempt number of this run. */
  attempt: number;
  maxAttempts: number;
  /** Clock-provided time for this run (never `new Date()` in domain code). */
  now: Date;
}

export interface JobHandler<S extends z.ZodType = z.ZodType> {
  type: string;
  payload: S;
  /** Attempts before 'dead' (default 6, 04 §7). Stored on the row at enqueue time. */
  maxAttempts?: number;
  handle: (payload: z.output<S>, ctx: JobContext) => Promise<void>;
}

/** Typed helper: `export const slackSend = defineJob({ type: 'slack.send', payload, handle })`. */
export function defineJob<S extends z.ZodType>(def: JobHandler<S>): JobHandler<S> {
  return def;
}
