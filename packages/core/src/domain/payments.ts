// Payment domain rules (I2.1, I2.4-I2.6). PURE: no I/O, `now` passed in. Owner: Lane C (T-143).

export type PaymentStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'refunded' | 'partially_refunded';

/** "PKR 50,000" / "USD 179.00": display text for the ORIGINAL agreed value. */
export function formatMoneyText(amountMinor: number, currency: string): string {
  const c = currency.toUpperCase();
  const zeroDecimal = ['JPY', 'KRW', 'VND'].includes(c);
  const major = zeroDecimal ? amountMinor : amountMinor / 100;
  const body = major.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${c} ${body}`;
}

export interface Charge {
  /** What Stripe bills. */
  amountMinor: number;
  currency: string; // upper-case ISO
  /** Original agreed value as text; null when no conversion happened. */
  displayText: string | null;
}

/**
 * Stripe does not onboard Pakistan, so the test account bills USD. A PKR value is converted at the configured
 * demo rate (paisa / rate = cents) and the original stays as `displayText`. Any other currency is billed as is.
 */
export function chargeFor(
  amountMinor: number,
  currency: string,
  chargeCurrency: string,
  pkrPerUsd: number,
): Charge {
  const from = currency.toUpperCase();
  const to = chargeCurrency.toUpperCase();
  if (from === to) return { amountMinor, currency: to, displayText: null };
  if (from === 'PKR' && to === 'USD') {
    return {
      amountMinor: Math.max(1, Math.round(amountMinor / pkrPerUsd)),
      currency: 'USD',
      displayText: formatMoneyText(amountMinor, 'PKR'),
    };
  }
  // No known rate: bill in the original currency (Stripe supports most) and say so.
  return { amountMinor, currency: from, displayText: null };
}

/** Stripe: Checkout sessions live between 30 minutes and 24 hours. */
export const MIN_EXPIRY_MINUTES = 30;
export const MAX_EXPIRY_MINUTES = 24 * 60;
export function clampExpiryMinutes(m: number | undefined): number {
  return Math.min(MAX_EXPIRY_MINUTES, Math.max(MIN_EXPIRY_MINUTES, Math.floor(m ?? MAX_EXPIRY_MINUTES)));
}

export type PaymentOutcome =
  | { kind: 'paid' }
  | { kind: 'expired' }
  | { kind: 'failed'; reason: string }
  | { kind: 'refund'; totalRefundedMinor: number; chargedMinor: number };

/**
 * Monotonic status transitions (04 §4 "Out-of-order"):
 *   pending -> paid -> (partially_)refunded;  pending -> expired | failed;
 *   failed | expired -> paid (money received wins: a retry after a decline, or a payment racing a cancel).
 *   A late `expired`/`failed` after `paid` is ignored.
 * Returns the new status, or null when the event must not change the status.
 */
export function nextPaymentStatus(current: PaymentStatus, o: PaymentOutcome): PaymentStatus | null {
  switch (o.kind) {
    case 'paid':
      return current === 'pending' || current === 'failed' || current === 'expired' ? 'paid' : null;
    case 'expired':
      return current === 'pending' ? 'expired' : null;
    case 'failed':
      return current === 'pending' ? 'failed' : null;
    case 'refund': {
      if (current === 'pending' || current === 'expired') return null; // refund of something never charged: ignore
      const next = o.totalRefundedMinor >= o.chargedMinor ? 'refunded' : 'partially_refunded';
      return next === current ? null : next;
    }
  }
}

/** Collected revenue = Σ charge − Σ refund (I2.6). Projected = Σ open (pending) requests. */
export function collected(sumChargeMinor: number, sumRefundMinor: number): number {
  return sumChargeMinor - sumRefundMinor;
}

/** Customer-facing message with the link (WhatsApp delivery is Lane C3's job; this only builds the text). */
export function paymentLinkText(
  p: {
    displayText: string | null;
    amountMinor: number;
    currency: string;
    description: string | null;
    url: string;
  },
  locale: 'en' | 'ur',
): string {
  const amount = p.displayText ?? formatMoneyText(p.amountMinor, p.currency);
  if (locale === 'ur') {
    return `${p.description ? `${p.description}: ` : ''}${amount}\nادائیگی کے لیے یہ محفوظ لنک کھولیں:\n${p.url}`;
  }
  return `${p.description ? `${p.description}: ` : ''}${amount}\nPlease pay securely here:\n${p.url}`;
}
