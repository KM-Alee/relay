// payment.create_checkout / payment.expire_checkout (04 §7). Idempotent by construction: re-read state, exit if done.
import { z } from 'zod';
import { expireCheckoutAtProvider, fulfillCheckout } from '../../services/payments';
import { defineJob } from '../types';

const payload = z.object({ paymentRequestId: z.uuid() });

export const paymentCreateCheckoutJob = defineJob({
  type: 'payment.create_checkout',
  payload,
  handle: async ({ paymentRequestId }, ctx) => {
    if (!ctx.workspaceId) throw new Error('payment.create_checkout requires a workspace');
    await fulfillCheckout(ctx.workspaceId, paymentRequestId, ctx.now);
  },
});

export const paymentExpireCheckoutJob = defineJob({
  type: 'payment.expire_checkout',
  payload,
  maxAttempts: 3,
  handle: async ({ paymentRequestId }, ctx) => {
    if (!ctx.workspaceId) throw new Error('payment.expire_checkout requires a workspace');
    await expireCheckoutAtProvider(ctx.workspaceId, paymentRequestId);
  },
});
