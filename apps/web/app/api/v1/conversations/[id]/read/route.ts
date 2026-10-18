// POST /api/v1/conversations/:id/read: clear the unread counter.
import { messagingEndpoints as e } from '@relay/contracts/api/messaging';
import { messagingService } from '@relay/core/services/messaging';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.contact.view',
  params: e.markRead.params,
  handler: ({ actor, params }) => messagingService.markRead(actor, params.id),
});
