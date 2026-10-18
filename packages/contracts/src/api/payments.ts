// payments API contracts (docs/11-api.md, I2.1-I2.8). Owner: Lane C (T-143).
// Amounts are `moneySchema`: masked for callers without crm.opportunity.value.view (F1.4).
import { z } from 'zod';
import { moneyFigureSchema, moneySchema } from '../money';
import { endpoint } from './endpoint';

export const paymentStatusSchema = z.enum([
  'pending',
  'paid',
  'expired',
  'failed',
  'refunded',
  'partially_refunded',
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentRequestDto = z.object({
  id: z.uuid(),
  opportunityId: z.uuid(),
  contactId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  requestedBy: z.uuid().nullable(),
  /** What Stripe charges (the test account bills USD). */
  amount: moneySchema,
  /** The original agreed value as text, e.g. "PKR 50,000" (null when masked). */
  displayText: z.string().nullable(),
  description: z.string().nullable(),
  status: paymentStatusSchema,
  /** Hosted Checkout URL; null until the session exists (outbox job). */
  url: z.url().nullable(),
  /** Stripe reference (checkout session id) and its test-dashboard link (I2.7). */
  providerRef: z.string().nullable(),
  dashboardUrl: z.url().nullable(),
  failureReason: z.string().nullable(),
  paidAt: z.iso.datetime({ offset: true }).nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  version: z.number().int(),
});
export type PaymentRequestDto = z.infer<typeof paymentRequestDto>;

export const createPaymentLinkInput = z.object({
  /** Defaults to the opportunity's value when omitted and it can be read. */
  amountMinor: z.number().int().positive().max(10_000_000_000).optional(),
  /** Currency of `amountMinor` (default: workspace currency). Converted when Stripe bills another currency. */
  currency: z.string().length(3).optional(),
  description: z.string().trim().min(1).max(200).optional(),
  contactId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  /** 30 minutes to 24 hours (Stripe limits). Default 24 h. */
  expiresInMinutes: z.number().int().min(30).max(1440).optional(),
});
export type CreatePaymentLinkInput = z.input<typeof createPaymentLinkInput>;

export const paymentTotals = z.object({
  currency: z.string().length(3),
  /** Sum of charges minus refunds (I2.6): the only figure the dashboard uses. */
  collected: moneyFigureSchema,
  /** Open (pending) requests: projected, not revenue. */
  projected: moneyFigureSchema,
  refunded: moneyFigureSchema,
});

export const paymentsListQuery = z.object({
  status: paymentStatusSchema.optional(),
  opportunityId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const paymentsListResponse = z.object({
  requests: z.array(paymentRequestDto),
  totals: paymentTotals,
});
export type PaymentsListResponse = z.infer<typeof paymentsListResponse>;

const idParams = z.object({ id: z.uuid() });

export const paymentsEndpoints = {
  createLink: endpoint({
    method: 'POST',
    path: '/api/v1/opportunities/:id/payment-links',
    params: idParams,
    body: createPaymentLinkInput,
    response: paymentRequestDto,
  }),
  list: endpoint({
    method: 'GET',
    path: '/api/v1/payments',
    query: paymentsListQuery,
    response: paymentsListResponse,
  }),
  sendWhatsapp: endpoint({
    method: 'POST',
    path: '/api/v1/payments/:id/send-whatsapp',
    params: idParams,
    response: z.object({ ok: z.literal(true), messageId: z.uuid() }),
  }),
  cancel: endpoint({
    method: 'POST',
    path: '/api/v1/payments/:id/cancel',
    params: idParams,
    response: paymentRequestDto,
  }),
} as const;
