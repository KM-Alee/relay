// api.realtime.*: owner Lane C. One method per endpoint in contracts/api/realtime.ts; pattern: ./users.ts.
import { realtimeEndpoints } from '@relay/contracts/api/realtime';
import { realtimeFixtures } from '@relay/contracts/fixtures/realtime';
import { call, type CallOptions } from '../http';

export const realtime = {
  /** GET /api/v1/changes?since=: polled change feed (use via `useRealtime()`, not directly). */
  changes: (query: { since?: string } = {}, opts?: CallOptions) =>
    call('realtime', realtimeEndpoints.changes, { query }, () => realtimeFixtures.changes(), opts),
};
