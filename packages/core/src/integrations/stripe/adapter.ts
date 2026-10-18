// Stripe adapter (test mode only; docs/04-integrations.md §4). Owner: Lane C (T-143).
// Verified 2026-10-18 against docs.stripe.com: Checkout Session create (mode=payment, expires_at 30 min-24 h,
// client_reference_id <= 200, metadata) with SDK stripe@23.0.0 pinned to API version 2026-09-30.endive
// (the SDK sends its own pinned version; we never override it).
// Thin translator: no DB, no business rules. Card data never touches this code (hosted Checkout, I2.8).
import Stripe from 'stripe';
import {
  ProviderError,
  type CheckoutInput,
  type Creds,
  type PaymentEvent,
  type PaymentProvider,
  type RawRequest,
} from '../types';

export const STRIPE_API_VERSION = Stripe.API_VERSION;
/** Webhook timestamp tolerance (replay window), seconds. Stripe's default. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const clients = new Map<string, Stripe>();
function client(creds: Creds): Stripe {
  const key = creds.secretKey;
  if (!key) throw new ProviderError('auth', 'stripe_not_configured', 'Stripe secret key is not configured');
  // I2.8 / "test mode only": a live key is refused outright.
  if (!key.startsWith('sk_test_'))
    throw new ProviderError('permanent', 'stripe_live_key_refused', 'Only Stripe TEST keys are allowed');
  let c = clients.get(key);
  if (!c) {
    c = new Stripe(key, { maxNetworkRetries: 0, timeout: 8_000, appInfo: { name: 'relay' } });
    clients.set(key, c);
  }
  return c;
}

/** Map SDK errors onto the outbox policy: network/5xx/429 retry, 401 -> auth, the rest permanent. */
export function mapStripeError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = err as {
    type?: string;
    statusCode?: number;
    code?: string;
    message?: string;
    headers?: Record<string, string>;
  };
  const code = e.code ?? e.type ?? 'stripe_error';
  const msg = String(e.message ?? code).replace(/(sk|rk|whsec)_[A-Za-z0-9_]+/g, '[redacted]');
  if (e.type === 'StripeAuthenticationError' || e.statusCode === 401)
    return new ProviderError('auth', code, msg);
  if (e.type === 'StripeRateLimitError' || e.statusCode === 429) {
    const ra = Number(e.headers?.['retry-after']);
    return new ProviderError('temporary', code, msg, Number.isFinite(ra) ? ra * 1000 : undefined);
  }
  if (
    e.type === 'StripeConnectionError' ||
    e.type === 'StripeAPIError' ||
    (e.statusCode ?? 0) >= 500 ||
    e.statusCode === undefined
  )
    return new ProviderError('temporary', code, msg);
  return new ProviderError('permanent', code, msg);
}

export function createStripeAdapter(): PaymentProvider {
  return {
    verifyWebhook(req: RawRequest, creds: Creds) {
      const sig = req.headers.get('stripe-signature');
      if (!sig) return { ok: false, reason: 'missing_signature' };
      const secret = creds.webhookSecret;
      if (!secret) return { ok: false, reason: 'no_webhook_secret' };
      try {
        // HMAC-SHA256 over `${t}.${rawBody}`, constant-time compare, timestamp tolerance (Stripe SDK).
        const ev = Stripe.webhooks.constructEvent(req.rawBody, sig, secret, WEBHOOK_TOLERANCE_SECONDS);
        return {
          ok: true,
          event: {
            id: ev.id,
            type: ev.type,
            created: ev.created,
            object: ev.data.object as unknown as Record<string, unknown>,
          } satisfies PaymentEvent,
        };
      } catch (err) {
        const m = String((err as Error).message ?? '');
        return { ok: false, reason: /tolerance/i.test(m) ? 'timestamp_outside_tolerance' : 'bad_signature' };
      }
    },

    async createCheckout(i: CheckoutInput, creds: Creds) {
      try {
        const s = await client(creds).checkout.sessions.create(
          {
            mode: 'payment',
            client_reference_id: i.paymentRequestId,
            success_url: i.successUrl,
            cancel_url: i.cancelUrl,
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: i.currency.toLowerCase(),
                  unit_amount: i.amountMinor,
                  product_data: { name: i.description.slice(0, 250) },
                },
              },
            ],
            metadata: { payment_request_id: i.paymentRequestId },
            // Charge/refund events carry the PaymentIntent metadata, which lets webhooks find the tenant.
            payment_intent_data: { metadata: { payment_request_id: i.paymentRequestId } },
            ...(i.expiresAt ? { expires_at: Math.floor(i.expiresAt.getTime() / 1000) } : {}),
          },
          { idempotencyKey: i.idempotencyKey },
        );
        if (!s.url)
          throw new ProviderError('permanent', 'no_checkout_url', 'Stripe returned no Checkout URL');
        return {
          providerRef: s.id,
          url: s.url,
          expiresAt: new Date((s.expires_at ?? Math.floor(Date.now() / 1000) + 86_400) * 1000),
        };
      } catch (err) {
        throw mapStripeError(err);
      }
    },

    async expireCheckout(providerRef: string, creds: Creds) {
      try {
        await client(creds).checkout.sessions.expire(providerRef);
      } catch (err) {
        const e = mapStripeError(err);
        // Already expired/completed: nothing to do.
        if (e.kind === 'permanent' && /expired|complete/i.test(e.message)) return;
        throw e;
      }
    },
  };
}
