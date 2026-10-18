// GET/POST /api/v1/opportunities (F2.1). Values are masked by the service (F1.4).
import { opportunitiesQuery, opportunityInput } from '@relay/contracts/api/crm';
import { opportunitiesService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.opportunity.view',
  query: opportunitiesQuery,
  handler: ({ actor, query }) => opportunitiesService.list(actor, query),
});

export const POST = route({
  auth: 'session',
  permission: 'crm.opportunity.create',
  body: opportunityInput,
  status: 201,
  handler: ({ actor, body }) => opportunitiesService.create(actor, body),
});
