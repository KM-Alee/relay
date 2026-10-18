// Fixture builders for payments contracts (13 §4). Owner: Lane C. Deterministic and schema-valid.
import type { PaymentRequestDto, PaymentsListResponse } from '../api/payments';

export function buildPaymentRequest(overrides: Partial<PaymentRequestDto> = {}): PaymentRequestDto {
  return {
    id: '0192f3a0-0000-7000-8000-000000000c01',
    opportunityId: '0192f3a0-0000-7000-8000-000000000c02',
    contactId: '0192f3a0-0000-7000-8000-000000000c03',
    conversationId: null,
    requestedBy: '0192f3a0-0000-7000-8000-000000000c04',
    amount: { masked: false, amountMinor: 17_900, currency: 'USD' },
    displayText: 'PKR 50,000',
    description: 'Deposit',
    status: 'pending',
    url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    providerRef: 'cs_test_fixture',
    dashboardUrl: 'https://dashboard.stripe.com/test/payments',
    failureReason: null,
    paidAt: null,
    expiresAt: '2026-10-19T10:00:00.000Z',
    createdAt: '2026-10-18T10:00:00.000Z',
    version: 0,
    ...overrides,
  };
}

export const paymentsFixtures = {
  createLink: () => buildPaymentRequest(),
  list: (): PaymentsListResponse => ({
    requests: [
      buildPaymentRequest(),
      buildPaymentRequest({
        id: '0192f3a0-0000-7000-8000-000000000c05',
        status: 'paid',
        paidAt: '2026-10-18T11:00:00.000Z',
      }),
    ],
    totals: {
      currency: 'USD',
      collected: { value: 17_900, masked: false },
      projected: { value: 17_900, masked: false },
      refunded: { value: 0, masked: false },
    },
  }),
  cancel: () => buildPaymentRequest({ status: 'expired' }),
} as const;
