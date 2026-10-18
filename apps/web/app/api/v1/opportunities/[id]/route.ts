// GET/PATCH/DELETE /api/v1/opportunities/:id.
import { idParams, opportunityUpdateInput } from '@relay/contracts/api/crm';
import { opportunitiesService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.opportunity.view',
  params: idParams,
  handler: ({ actor, params }) => opportunitiesService.get(actor, params.id),
});

export const PATCH = route({
  auth: 'session',
  permission: 'crm.opportunity.edit',
  params: idParams,
  body: opportunityUpdateInput,
  handler: ({ actor, params, body }) => opportunitiesService.update(actor, params.id, body),
});

export const DELETE = route({
  auth: 'session',
  permission: 'crm.opportunity.delete',
  params: idParams,
  handler: ({ actor, params }) => opportunitiesService.remove(actor, params.id),
});
