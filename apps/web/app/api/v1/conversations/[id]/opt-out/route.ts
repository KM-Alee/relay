// POST /api/v1/conversations/:id/opt-out: apply / clear opt-out (I1.9). Audited.
import { messagingEndpoints as e } from '@relay/contracts/api/messaging';
import { messagingService } from '@relay/core/services/messaging';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'messaging.send',
  params: e.optOut.params,
  body: e.optOut.body,
  handler: ({ actor, params, body }) => messagingService.setOptOut(actor, params.id, body.optedOut),
});
