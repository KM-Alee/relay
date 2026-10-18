import { describe, expect, it } from 'vitest';
import { chargeFor, clampExpiryMinutes, nextPaymentStatus } from './payments';

describe('payment domain', () => {
  it('[I2.1] PKR is billed in USD at the demo rate and the original value is kept as text', () => {
    expect(chargeFor(5_000_000, 'PKR', 'usd', 280)).toEqual({
      amountMinor: 17_857,
      currency: 'USD',
      displayText: 'PKR 50,000',
    });
    expect(chargeFor(1_000, 'USD', 'usd', 280)).toEqual({
      amountMinor: 1_000,
      currency: 'USD',
      displayText: null,
    });
  });

  it('[I2.1] link expiry is clamped to Stripe limits (30 min - 24 h)', () => {
    expect(clampExpiryMinutes(5)).toBe(30);
    expect(clampExpiryMinutes(99_999)).toBe(1440);
    expect(clampExpiryMinutes(undefined)).toBe(1440);
  });

  it('[I2.5] statuses are monotonic: late expired/failed after paid is ignored, a paid after a decline wins', () => {
    expect(nextPaymentStatus('paid', { kind: 'expired' })).toBeNull();
    expect(nextPaymentStatus('paid', { kind: 'failed', reason: 'x' })).toBeNull();
    expect(nextPaymentStatus('failed', { kind: 'paid' })).toBe('paid');
    expect(nextPaymentStatus('expired', { kind: 'paid' })).toBe('paid');
    expect(nextPaymentStatus('paid', { kind: 'refund', totalRefundedMinor: 10, chargedMinor: 100 })).toBe(
      'partially_refunded',
    );
    expect(
      nextPaymentStatus('partially_refunded', { kind: 'refund', totalRefundedMinor: 100, chargedMinor: 100 }),
    ).toBe('refunded');
    expect(
      nextPaymentStatus('pending', { kind: 'refund', totalRefundedMinor: 100, chargedMinor: 100 }),
    ).toBeNull();
  });
});
