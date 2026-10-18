// realtime API contracts: the polled change feed (ADR-0003, docs/07 §2, docs/11 §"changes"). Owner: Lane C.
// Events are HINTS: {topic, ids}, never record data. Clients refetch through the permissioned API.
import { z } from 'zod';
import { endpoint } from './endpoint';

/**
 * Topics map 1:1 to the first segment of a TanStack query key (docs/07 §2 "Query keys").
 * Adding a topic: append here (additive edit), emit it, and key your queries `[topic, …]`.
 */
export const REALTIME_TOPICS = [
  'leads',
  'recovery',
  'radar',
  'conversations',
  'messages',
  'contacts',
  'opportunities',
  'payments',
  'appointments',
  'dashboard',
  'notifications',
  'integrations',
  'team',
] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];
export const realtimeTopicSchema = z.enum(REALTIME_TOPICS);

/** Server retention of hints; a `since` older than this gets `reset: true`. */
export const REALTIME_RETENTION_SECONDS = 600;
/** Max hints per response; more than this also yields `reset: true` (client refetches everything). */
export const REALTIME_MAX_CHANGES = 500;

export const changesQuery = z.object({
  /** Cursor: the previous response's `now` (minus the client's overlap). Omit on first call to get a cursor. */
  since: z.iso.datetime({ offset: true }).optional(),
});
export type ChangesQuery = z.infer<typeof changesQuery>;

export const realtimeChange = z.object({
  /** Event id: the client dedupes on it (polls overlap on purpose). */
  id: z.uuid(),
  topic: realtimeTopicSchema,
  /** Affected record ids; empty = "the whole topic changed". */
  ids: z.array(z.uuid()),
  at: z.iso.datetime({ offset: true }),
});
export type RealtimeChange = z.infer<typeof realtimeChange>;

export const changesResponse = z.object({
  /** Server (DB) clock. Use it for the next `since`, never the client clock. */
  now: z.iso.datetime({ offset: true }),
  /** True when hints may have been missed (cursor too old, or too many events): invalidate everything. */
  reset: z.boolean(),
  changes: z.array(realtimeChange),
});
export type ChangesResponse = z.infer<typeof changesResponse>;

export const realtimeEndpoints = {
  /** GET /api/v1/changes?since=: hints for the actor's workspace (and user), filtered by permission. */
  changes: endpoint({
    method: 'GET',
    path: '/api/v1/changes',
    response: changesResponse,
    query: changesQuery,
  }),
} as const;
