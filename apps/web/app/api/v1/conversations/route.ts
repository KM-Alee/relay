// GET /api/v1/conversations: inbox list (crm.contact.view + record scope).
import { messagingEndpoints as e } from '@relay/contracts/api/messaging';
import { messagingService } from '@relay/core/services/messaging';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.contact.view',
  query: e.list.query,
  handler: ({ actor, query }) => messagingService.listConversations(actor, query),
});
