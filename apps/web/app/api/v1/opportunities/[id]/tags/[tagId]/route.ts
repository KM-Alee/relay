// DELETE /api/v1/opportunities/:id/tags/:tagId: detach a tag.
import { tagAttachParams } from '@relay/contracts/api/crm';
import { opportunitiesService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const DELETE = route({
  auth: 'session',
  permission: 'crm.opportunity.edit',
  params: tagAttachParams,
  handler: ({ actor, params }) => opportunitiesService.tag(actor, params.id, params.tagId, false),
});
