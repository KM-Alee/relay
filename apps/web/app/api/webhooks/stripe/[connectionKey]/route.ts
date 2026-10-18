// POST /api/webhooks/stripe/[connectionKey]: Stripe test-mode events (04 §2/§4; I2.3, I2.4).
// `default` = the platform endpoint (env STRIPE_WEBHOOK_SECRET); otherwise a workspace connection key.
import { handleStripeWebhook } from '@/lib/webhooks/stripe';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ connectionKey: string }> }) {
  return handleStripeWebhook(req, ctx.params);
}
