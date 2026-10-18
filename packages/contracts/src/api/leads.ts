// leads API contracts: Zod request/response schemas + endpoint descriptors (docs/11-api.md). Owner: Lane A.
// Pattern: see ./users.ts (worked example) and 13 §4 "How to add an endpoint in 5 steps".
import { z } from 'zod';
import { endpoint } from './endpoint';

/** POST /api/v1/tick-nudge → 202. The server runs due work after responding; it changes nothing itself. */
export const tickNudgeResponse = z.object({ accepted: z.literal(true) });
export type TickNudgeResponse = z.infer<typeof tickNudgeResponse>;

export const leadsEndpoints = {
  /**
   * Countdown hit 0 / Lead Radar overdue (07 §3): ask the server to run due work now, so an
   * escalation lands promptly even if the QStash wake is late. Session + CSRF, 6/min per user.
   */
  tickNudge: endpoint({ method: 'POST', path: '/api/v1/tick-nudge', response: tickNudgeResponse }),
} as const;
