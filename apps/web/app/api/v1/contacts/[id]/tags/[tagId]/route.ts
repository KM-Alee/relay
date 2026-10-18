// DELETE /api/v1/contacts/:id/tags/:tagId: detach a tag.
import { tagAttachParams } from '@relay/contracts/api/crm';
import { contactsService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const DELETE = route({
  auth: 'session',
  permission: 'crm.contact.edit',
  params: tagAttachParams,
  handler: ({ actor, params }) => contactsService.tag(actor, params.id, params.tagId, false),
});
