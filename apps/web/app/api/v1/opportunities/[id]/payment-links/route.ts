// POST /api/v1/opportunities/:id/payment-links: create a Stripe Checkout payment request (I2.1; payments.request).
import { createPaymentLinkInput } from '@relay/contracts/api/payments';
import { paymentsService } from '@relay/core/services/payments';
import { z } from 'zod';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'payments.request',
  params: z.object({ id: z.uuid() }),
  body: createPaymentLinkInput,
  rateLimit: { name: 'payments.create', limit: 30, windowSeconds: 60, by: 'user' },
  status: 201,
  handler: async ({ actor, params, body }) => {
    const dto = await paymentsService.createRequest(actor, params.id, body);
    kickDueWork(); // the outbox job is the retry safety net if the inline session creation failed
    return dto;
  },
});
