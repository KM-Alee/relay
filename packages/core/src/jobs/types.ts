// Outbox job handler contract (docs/01-architecture.md §6, docs/03-lead-engine.md). Owner: Lane A (T-008).
// A handler declares its `type` (`<area>.<verb>`, 10 §2), a Zod payload schema, and `handle()`.
// Handlers run OUTSIDE the enqueueing transaction; external calls are allowed here (rule 3), and
// must be idempotent (at-least-once delivery: use `ctx.jobId` / a dedupe key).
import type { z } from 'zod';

export interface JobContext {
  /** Outbox row id: use as idempotency key towards providers. */
  jobId: string;
  workspaceId: string | null;
  attempt: number;
  /** Clock-provided time for this run (never `new Date()` in domain code). */
  now: Date;
}

export interface JobHandler<S extends z.ZodType = z.ZodType> {
  type: string;
  payload: S;
  handle: (payload: z.output<S>, ctx: JobContext) => Promise<void>;
}

/** Typed helper: `export const slackSend = defineJob({ type: 'slack.send', payload, handle })`. */
export function defineJob<S extends z.ZodType>(def: JobHandler<S>): JobHandler<S> {
  return def;
}
