// Fixture builders for leads contracts (13 §4). Owner: Lane A. Pattern: ./users.ts.
import type { TickNudgeResponse } from '../api/leads';

export function buildTickNudge(): TickNudgeResponse {
  return { accepted: true };
}

/** One entry per endpoint in leadsEndpoints, used by the api-client in fixture mode. */
export const leadsFixtures = {
  tickNudge: () => buildTickNudge(),
} as const;
