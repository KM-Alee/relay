// GET/POST /api/v1/conversations/:id/messages: thread + composer (I1.3, I1.9, I1.10).
import { messagingEndpoints as e } from '@relay/contracts/api/messaging';
import { messagingService } from '@relay/core/services/messaging';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.contact.view',
  params: e.messages.params,
  query: e.messages.query,
  handler: ({ actor, params, query }) => messagingService.listMessages(actor, params.id, query),
});

export const POST = route({
  auth: 'session',
  permission: 'messaging.send',
  params: e.send.params,
  body: e.send.body,
  rateLimit: { name: 'messages.send', limit: 60, windowSeconds: 60, by: 'user' },
  status: 201,
  handler: ({ actor, params, body }) => messagingService.send(actor, params.id, body),
});
