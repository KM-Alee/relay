// POST /api/v1/activities: note or call log (F2.13).
import { activityInput } from '@relay/contracts/api/crm';
import { crmActivityService } from '@relay/core/services/crm-activity';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.contact.edit',
  body: activityInput,
  status: 201,
  handler: ({ actor, body }) => crmActivityService.create(actor, body),
});
