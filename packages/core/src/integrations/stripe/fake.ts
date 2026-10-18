// Fake Stripe for tests and the Judge Console (swapped in via the registry). Signature verification stays REAL
// (same code path as production); only the outbound calls are faked. Owner: Lane C (T-143).
import Stripe from 'stripe';
import { createStripeAdapter } from './adapter';
import type { CheckoutInput, PaymentProvider } from '../types';

/** Build a Stripe-Signature header for `payload` exactly as Stripe does (t=<ts>,v1=<hmac>). */
export function signStripePayload(payload: string, secret: string, timestamp?: number): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}

/** A minimal Stripe event JSON body (what Stripe POSTs). */
export function stripeEventBody(args: {
  id: string;
  type: string;
  object: Record<string, unknown>;
  created?: number;
}): string {
  return JSON.stringify({
    id: args.id,
    object: 'event',
    api_version: Stripe.API_VERSION,
    created: args.created ?? Math.floor(Date.now() / 1000),
    type: args.type,
    livemode: false,
    pending_webhooks: 1,
    data: { object: args.object },
  });
}

export interface FakeStripe extends PaymentProvider {
  created: Array<CheckoutInput & { providerRef: string }>;
  expired: string[];
  /** Make the next createCheckout throw. */
  failNext: Error | null;
}

export function createFakeStripe(): FakeStripe {
  const real = createStripeAdapter();
  const fake: FakeStripe = {
    created: [],
    expired: [],
    failNext: null,
    verifyWebhook: real.verifyWebhook,
    async createCheckout(i) {
      if (fake.failNext) {
        const e = fake.failNext;
        fake.failNext = null;
        throw e;
      }
      const providerRef = `cs_test_fake_${i.paymentRequestId.replaceAll('-', '').slice(0, 24)}`;
      fake.created.push({ ...i, providerRef });
      return {
        providerRef,
        url: `https://checkout.stripe.com/c/pay/${providerRef}`,
        expiresAt: i.expiresAt ?? new Date(Date.now() + 86_400_000),
      };
    },
    async expireCheckout(ref) {
      fake.expired.push(ref);
    },
  };
  return fake;
}
