// GET/POST /api/v1/contacts (F2.1): scoped list + create.
import { contactsQuery, contactInput } from '@relay/contracts/api/crm';
import { contactsService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.contact.view',
  query: contactsQuery,
  handler: ({ actor, query }) => contactsService.list(actor, query),
});

export const POST = route({
  auth: 'session',
  permission: 'crm.contact.create',
  body: contactInput,
  status: 201,
  handler: ({ actor, body }) => contactsService.create(actor, body),
});
