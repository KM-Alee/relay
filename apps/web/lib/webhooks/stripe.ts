// Stripe webhook handler (04 §2): raw body -> verify -> record (+outbox) -> 200 -> after() process.
// Never parses or acts before the signature is verified (that is inside ingestStripe).
import { log } from '@relay/core/log';
import '@relay/core/services/register-hooks';
import { processStripeEvent } from '@relay/core/services/payments';
import { ingestStripe } from '@relay/core/services/stripe-ingest';
import { after } from 'next/server';
import { clientIp } from '@/lib/http/request';

export async function handleStripeWebhook(
  req: Request,
  params: Promise<{ connectionKey: string }>,
): Promise<Response> {
  const rawBody = await req.text(); // BEFORE any parsing
  const { connectionKey } = await params;
  let result;
  try {
    result = await ingestStripe({
      connectionKey,
      req: { method: req.method, url: new URL(req.url), headers: req.headers, rawBody },
      ip: clientIp(req),
    });
  } catch (err) {
    log.error('stripe.webhook_failed', { err });
    return new Response('error', { status: 500 }); // Stripe retries
  }
  if (result.newEvents.length) {
    after(async () => {
      for (const e of result.newEvents) {
        try {
          await processStripeEvent(e.eventId, e.workspaceId);
        } catch (err) {
          log.error('stripe.after_process_failed', { eventId: e.eventId, err });
        }
      }
    });
  }
  const text = result.status === 400 ? 'bad signature' : result.status === 404 ? 'not found' : 'ok';
  return new Response(result.status === 200 ? null : text, { status: result.status });
}
