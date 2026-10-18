// Stripe event -> the minimal normalized record we persist (for processing and replay, I5.9). PURE.
// Never copies card/payment-method details or customer PII (I2.8): only ids, amounts, status, a short reason.
import { redactText } from '../redact';
import type { PaymentEvent } from '../types';

export const HANDLED_STRIPE_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'charge.refunded',
] as const;
export type HandledStripeEvent = (typeof HANDLED_STRIPE_EVENTS)[number];

export interface NormalizedStripeEvent {
  eventId: string;
  type: HandledStripeEvent;
  /** cs_… for checkout.session.*; null otherwise. */
  sessionId: string | null;
  paymentIntent: string | null;
  chargeId: string | null;
  paymentRequestId: string | null;
  /** checkout.session.*: 'paid' | 'unpaid' | 'no_payment_required'. */
  paymentStatus: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** charge.refunded: cumulative refunded amount. */
  amountRefundedMinor: number | null;
  failureReason: string | null;
  createdAt: number;
}

export const isHandledStripeEvent = (t: string): t is HandledStripeEvent =>
  (HANDLED_STRIPE_EVENTS as readonly string[]).includes(t);

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? str((v as { id?: unknown }).id) : null;

/** Returns null for event types we do not handle (stored as `ignored`). */
export function normalizeStripeEvent(ev: PaymentEvent): NormalizedStripeEvent | null {
  if (!isHandledStripeEvent(ev.type)) return null;
  const o = ev.object;
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  const base: NormalizedStripeEvent = {
    eventId: ev.id,
    type: ev.type,
    sessionId: null,
    paymentIntent: null,
    chargeId: null,
    paymentRequestId: str(meta.payment_request_id),
    paymentStatus: null,
    amountMinor: null,
    currency: str(o.currency)?.toUpperCase() ?? null,
    amountRefundedMinor: null,
    failureReason: null,
    createdAt: ev.created,
  };
  if (ev.type.startsWith('checkout.session.')) {
    return {
      ...base,
      sessionId: str(o.id),
      paymentIntent: idOf(o.payment_intent),
      paymentRequestId: base.paymentRequestId ?? str(o.client_reference_id),
      paymentStatus: str(o.payment_status),
      amountMinor: num(o.amount_total),
    };
  }
  if (ev.type === 'payment_intent.payment_failed') {
    const err = (o.last_payment_error ?? {}) as Record<string, unknown>;
    const reason = str(err.decline_code) ?? str(err.code) ?? str(err.message) ?? 'payment_failed';
    return {
      ...base,
      paymentIntent: str(o.id),
      amountMinor: num(o.amount),
      failureReason: redactText(reason, 200),
    };
  }
  // charge.refunded
  return {
    ...base,
    chargeId: str(o.id),
    paymentIntent: idOf(o.payment_intent),
    amountMinor: num(o.amount),
    amountRefundedMinor: num(o.amount_refunded),
  };
}
