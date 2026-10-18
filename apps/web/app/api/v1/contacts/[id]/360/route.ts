// GET /api/v1/contacts/:id/360 (F2.8): the complete customer view.
import { idParams } from '@relay/contracts/api/crm';
import '@relay/core/services/contact360-providers'; // registers conversations / payments / appointments
import { contact360Service } from '@relay/core/services/crm-contact360';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.contact.view',
  params: idParams,
  handler: ({ actor, params }) => contact360Service.get(actor, params.id),
});
