// Outbox job registry: job type → handler (13 §3). ONE line per handler; lanes add their own lines.
// runDueWork() (outbox processor) looks up the handler by type and parses the payload before
// calling it. An invalid payload is a permanent failure ('dead'); an UNKNOWN type is retried with
// backoff (deploy skew: an older instance may claim a row enqueued by newer code) and dead-letters
// only after max_attempts. enqueue() validates payloads up front, so bad payloads fail at the source.
import type { z } from 'zod';
import { AppError } from '../errors';
import { appointmentConfirmJob } from './handlers/appointment-confirm';
import {
  calendarCancelEventJob,
  calendarCreateEventJob,
  calendarUpdateEventJob,
} from './handlers/calendar-event';
import { integrationProcessJob } from './handlers/integration-process';
import { leadRetryRoutingJob } from './handlers/lead-retry-routing';
import { noopJob } from './handlers/noop';
import { paymentCreateCheckoutJob, paymentExpireCheckoutJob } from './handlers/payment-checkout';
import { wakeScheduleJob } from './handlers/wake-schedule';
import { slackSendJob } from './handlers/slack-send';
import { slackUpdateJob } from './handlers/slack-update';
import { mediaDownloadJob } from './handlers/media-download';
import { whatsappSendJob } from './handlers/whatsapp-send';
import type { JobContext, JobHandler } from './types';

const handlers = [
  noopJob, // W0 example
  wakeScheduleJob, // A · T-008: QStash wake-up (ensureWakeBy)
  slackSendJob, // C: T-145
  slackUpdateJob, // C: T-145
  integrationProcessJob, // C: T-140/T-145
  whatsappSendJob, // C: T-141
  mediaDownloadJob, // C: T-142
  paymentCreateCheckoutJob, // C: T-143
  paymentExpireCheckoutJob, // C: T-143
  calendarCreateEventJob, // C: T-144
  calendarUpdateEventJob, // C: T-144
  calendarCancelEventJob, // C: T-144
  appointmentConfirmJob, // C: T-216 (I3.9)
  leadRetryRoutingJob, // A · T-125: lead.retry_routing {teamId}
] as const satisfies readonly JobHandler[];

type Handlers = (typeof handlers)[number];
export type JobType = Handlers['type'];
/** Payload accepted by enqueue() for each registered type. */
export type JobPayload<T extends JobType> = z.input<Extract<Handlers, { type: T }>['payload']>;

export type JobRegistry = ReadonlyMap<string, JobHandler>;

export const jobRegistry: JobRegistry = new Map(handlers.map((h) => [h.type, h as unknown as JobHandler]));

if (jobRegistry.size !== handlers.length) throw new Error('duplicate job type in core/jobs/registry.ts');

/** Build a registry from handlers (tests, Judge Console scenarios). */
export function createJobRegistry(list: readonly JobHandler[]): JobRegistry {
  const m = new Map(list.map((h) => [h.type, h]));
  if (m.size !== list.length) throw new Error('duplicate job type');
  return m;
}

export function getJobHandler(type: string, registry: JobRegistry = jobRegistry): JobHandler {
  const h = registry.get(type);
  if (!h) throw new AppError('INTERNAL', { message: `unknown job type: ${type}` });
  return h;
}

/** Parse the payload with the handler's schema, then run it. */
export async function runJob(type: string, payload: unknown, ctx: JobContext): Promise<void> {
  const h = getJobHandler(type);
  await h.handle(h.payload.parse(payload), ctx);
}
