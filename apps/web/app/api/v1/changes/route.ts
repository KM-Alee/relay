// GET /api/v1/changes?since=: polled change feed (T-009, Q11, ADR-0003). Session required; own workspace only.
import { changesQuery } from '@relay/contracts/api/realtime';
import { realtimeService } from '@relay/core/services/realtime';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  query: changesQuery,
  // Every open tab polls every 1-2 s; the cap is generous and only stops runaway loops.
  rateLimit: { name: 'changes', limit: 240, windowSeconds: 60, by: 'user' },
  handler: ({ actor, query }) => realtimeService.changes(actor, query),
});
