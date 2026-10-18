// Outbox job registry: job type → handler (13 §3). ONE line per handler; lanes add their own lines.
// runDueWork() (T-008) looks up the handler with getJobHandler() and parses the payload before
// calling it; an unknown type or invalid payload is a permanent failure (dead-letter), not a retry.
import { AppError } from '../errors';
import { noopJob } from './handlers/noop';
import type { JobContext, JobHandler } from './types';

const handlers = [
  noopJob, // W0 example
] as const satisfies readonly JobHandler[];

export type JobType = (typeof handlers)[number]['type'];

export const jobRegistry: ReadonlyMap<string, JobHandler> = new Map(
  handlers.map((h) => [h.type, h as unknown as JobHandler]),
);

if (jobRegistry.size !== handlers.length) throw new Error('duplicate job type in core/jobs/registry.ts');

export function getJobHandler(type: string): JobHandler {
  const h = jobRegistry.get(type);
  if (!h) throw new AppError('INTERNAL', { message: `unknown job type: ${type}` });
  return h;
}

/** Parse the payload with the handler's schema, then run it. */
export async function runJob(type: string, payload: unknown, ctx: JobContext): Promise<void> {
  const h = getJobHandler(type);
  await h.handle(h.payload.parse(payload), ctx);
}
