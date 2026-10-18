// Adapter registry (04 §1): maps provider → adapter. Tests and the Judge Console swap fakes in here;
// INTEGRATIONS_FAKE=1 selects them (refused in production by config.testing). Owner: Lane C.
import { config } from '../config';
import { createGoogleAdapter } from './google/adapter';
import { createFakeGoogle, type FakeGoogle } from './google/fake';
import { createSlackAdapter } from './slack/adapter';
import { createFakeSlack, type FakeSlack } from './slack/fake';
import { createFakeMeta, type FakeMeta } from './meta/fake';
import { createMetaAdapter } from './meta/adapter';
import { createStripeAdapter } from './stripe/adapter';
import { createFakeStripe, type FakeStripe } from './stripe/fake';
import type { CalendarProvider, MessagingProvider, Notifier, PaymentProvider } from './types';

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

// ── Messaging (WhatsApp, T-141) ─────────────────────────────────────────
let msgOverride: MessagingProvider | null = null;
let fakeMeta: FakeMeta | null = null;
const realMeta = createMetaAdapter();

export function setMessaging(m: MessagingProvider | null): void {
  msgOverride = m;
}
export function getFakeMeta(): FakeMeta {
  return (fakeMeta ??= createFakeMeta());
}
export function getMessaging(): MessagingProvider {
  if (msgOverride) return msgOverride;
  if (config.testing.INTEGRATIONS_FAKE) return getFakeMeta();
  return realMeta;
}

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

// ── Google Calendar (T-144) ─────────────────────────────────────────────
let calendarOverride: CalendarProvider | null = null;
let fakeGoogle: FakeGoogle | null = null;
const realGoogle = createGoogleAdapter();

export function setCalendarProvider(p: CalendarProvider | null): void {
  calendarOverride = p;
}
export function getFakeGoogle(): FakeGoogle {
  return (fakeGoogle ??= createFakeGoogle());
}
export function getCalendarProvider(): CalendarProvider {
  if (calendarOverride) return calendarOverride;
  if (config.testing.INTEGRATIONS_FAKE) return getFakeGoogle();
  return realGoogle;
}
