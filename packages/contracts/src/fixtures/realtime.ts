// Fixture builders for realtime contracts (13 §4). Owner: Lane C. Pattern: ./users.ts.
import type { ChangesResponse } from '../api/realtime';
import { FIXTURE_WORKSPACE_ID } from './users';

export const FIXTURE_CHANGE_ID = '0192f3a0-0000-7000-8000-000000000f01';
export const FIXTURE_LEAD_ID = '0192f3a0-0000-7000-8000-000000000301';

export function buildChanges(overrides: Partial<ChangesResponse> = {}): ChangesResponse {
  return {
    now: '2026-10-18T10:00:02.000Z',
    reset: false,
    changes: [
      { id: FIXTURE_CHANGE_ID, topic: 'leads', ids: [FIXTURE_LEAD_ID], at: '2026-10-18T10:00:01.500Z' },
    ],
    ...overrides,
  };
}

/** One entry per endpoint in realtimeEndpoints, used by the api-client in fixture mode. */
export const realtimeFixtures = {
  changes: () => buildChanges(),
};

export { FIXTURE_WORKSPACE_ID };
