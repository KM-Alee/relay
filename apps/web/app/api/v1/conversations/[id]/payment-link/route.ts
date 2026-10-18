// POST /api/v1/conversations/:id/payment-link: the inbox "$" button (T-216, I2.1). Creates a Stripe Checkout
// link for the contact's open opportunity and sends it in the WhatsApp thread (template outside the 24 h window).
import { paymentsEndpoints as e } from '@relay/contracts/api/payments';
import { paymentsService } from '@relay/core/services/payments';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'payments.request',
  params: e.sendInConversation.params,
  body: e.sendInConversation.body,
  rateLimit: { name: 'payments.send', limit: 30, windowSeconds: 60, by: 'user' },
  status: 201,
  handler: async ({ actor, params, body }) => {
    const r = await paymentsService.sendLinkInConversation(actor, params.id, body);
    kickDueWork();
    return r;
  },
});
