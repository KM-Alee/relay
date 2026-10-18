// POST /api/v1/contacts/:id/tags: attach a tag.
import { idParams, attachTagInput } from '@relay/contracts/api/crm';
import { contactsService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.contact.edit',
  params: idParams,
  body: attachTagInput,
  handler: ({ actor, params, body }) => contactsService.tag(actor, params.id, body.tagId, true),
});
