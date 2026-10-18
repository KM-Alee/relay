// Adapter registry (04 §1): maps provider → adapter. Tests and the Judge Console swap fakes in here;
// INTEGRATIONS_FAKE=1 selects them (refused in production by config.testing). Owner: Lane C.
import { config } from '../config';
import { createSlackAdapter } from './slack/adapter';
import { createFakeSlack, type FakeSlack } from './slack/fake';
import { createStripeAdapter } from './stripe/adapter';
import { createFakeStripe, type FakeStripe } from './stripe/fake';
import type { Notifier, PaymentProvider } from './types';

let override: Notifier | null = null;
let fake: FakeSlack | null = null;

export function setNotifier(n: Notifier | null): void {
  override = n;
}

/** The process-wide fake (tests read `.posted` / `.updated`). */
export function getFakeSlack(): FakeSlack {
  return (fake ??= createFakeSlack());
}

export function getNotifier(): Notifier {
  if (override) return override;
  if (config.testing.INTEGRATIONS_FAKE) return getFakeSlack();
  return realSlack;
}

const realSlack = createSlackAdapter();

// ── Stripe (T-143) ──────────────────────────────────────────────────────
let paymentOverride: PaymentProvider | null = null;
let fakeStripe: FakeStripe | null = null;
const realStripe = createStripeAdapter();

export function setPaymentProvider(p: PaymentProvider | null): void {
  paymentOverride = p;
}
export function getFakeStripe(): FakeStripe {
  return (fakeStripe ??= createFakeStripe());
}
export function getPaymentProvider(): PaymentProvider {
  if (paymentOverride) return paymentOverride;
  if (config.testing.INTEGRATIONS_FAKE) return getFakeStripe();
  return realStripe;
}
