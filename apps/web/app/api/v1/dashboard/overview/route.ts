// GET /api/v1/dashboard/overview (F5.1, F5.4): every overview figure for the actor's scope. Owner: Lane D.
import { overviewQuery } from '@relay/contracts/api/dashboard';
import * as metrics from '@relay/core/services/metrics';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  query: overviewQuery,
  handler: ({ actor, query }) => metrics.overview(actor, query),
});
