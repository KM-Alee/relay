// POST /api/v1/payments/:id/send-whatsapp: send a ready payment link in the customer's WhatsApp thread
// (payments.request + messaging.send; delivery is the whatsapp.send outbox job).
import { paymentsService } from '@relay/core/services/payments';
import { z } from 'zod';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'payments.request',
  params: z.object({ id: z.uuid() }),
  rateLimit: { name: 'payments.send', limit: 30, windowSeconds: 60, by: 'user' },
  handler: async ({ actor, params }) => {
    const r = await paymentsService.sendViaWhatsApp(actor, params.id);
    kickDueWork();
    return r;
  },
});
