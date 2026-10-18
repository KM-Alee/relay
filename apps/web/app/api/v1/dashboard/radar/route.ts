// GET /api/v1/dashboard/radar (F5.6): waiting leads + team availability for Lead Radar. Owner: Lane D.
import * as metrics from '@relay/core/services/metrics';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session', handler: ({ actor }) => metrics.radar(actor) });
