// POST /api/v1/conversations/:id/messages/:messageId/retry: re-queue a failed message (I1.7).
import { messagingEndpoints as e } from '@relay/contracts/api/messaging';
import { messagingService } from '@relay/core/services/messaging';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'messaging.send',
  params: e.retry.params,
  rateLimit: { name: 'messages.retry', limit: 30, windowSeconds: 60, by: 'user' },
  handler: ({ actor, params }) => messagingService.retry(actor, params.id, params.messageId),
});
