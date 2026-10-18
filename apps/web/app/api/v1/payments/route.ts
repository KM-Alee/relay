// GET /api/v1/payments: payment requests + collected/projected totals (I2.5-I2.7; payments.request).
import { paymentsListQuery } from '@relay/contracts/api/payments';
import { paymentsService } from '@relay/core/services/payments';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'payments.request',
  query: paymentsListQuery,
  handler: ({ actor, query }) => paymentsService.list(actor, query),
});
