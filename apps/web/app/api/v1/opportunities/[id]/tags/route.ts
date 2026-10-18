// POST /api/v1/opportunities/:id/tags: attach a tag.
import { idParams, attachTagInput } from '@relay/contracts/api/crm';
import { opportunitiesService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.opportunity.edit',
  params: idParams,
  body: attachTagInput,
  handler: ({ actor, params, body }) => opportunitiesService.tag(actor, params.id, body.tagId, true),
});
