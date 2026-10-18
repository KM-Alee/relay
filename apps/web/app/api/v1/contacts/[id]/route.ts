// GET/PATCH/DELETE /api/v1/contacts/:id. Out-of-scope / other-workspace ids → 404; stale version → 409.
import { idParams, contactUpdateInput } from '@relay/contracts/api/crm';
import { contactsService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.contact.view',
  params: idParams,
  handler: ({ actor, params }) => contactsService.get(actor, params.id),
});

export const PATCH = route({
  auth: 'session',
  permission: 'crm.contact.edit',
  params: idParams,
  body: contactUpdateInput,
  handler: ({ actor, params, body }) => contactsService.update(actor, params.id, body),
});

export const DELETE = route({
  auth: 'session',
  permission: 'crm.contact.delete',
  params: idParams,
  handler: ({ actor, params }) => contactsService.remove(actor, params.id),
});
