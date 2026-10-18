// GET /api/v1/leads/:id: detail + events + routing trace. Out of scope / other workspace → 404. Lane A.
import { leadIdParams } from '@relay/contracts/api/leads';
import { leadsService } from '@relay/core/services/leads';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  params: leadIdParams,
  handler: ({ actor, params }) => leadsService.get(actor, params.id),
});
