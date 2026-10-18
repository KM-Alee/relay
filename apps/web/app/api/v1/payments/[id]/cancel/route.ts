// POST /api/v1/payments/:id/cancel: expire a pending payment link (payments.request).
import { paymentsService } from '@relay/core/services/payments';
import { z } from 'zod';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'payments.request',
  params: z.object({ id: z.uuid() }),
  handler: async ({ actor, params }) => {
    const dto = await paymentsService.cancelRequest(actor, params.id);
    kickDueWork();
    return dto;
  },
});
