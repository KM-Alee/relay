// whatsapp.send: deliver one queued message (04 §7, I1.3/I1.7). Retries/backoff/dead-lettering come from the runner.
import { z } from 'zod';
import { deliverMessage } from '../../services/messaging';
import { defineJob } from '../types';

export const whatsappSendJob = defineJob({
  type: 'whatsapp.send',
  payload: z.object({ messageId: z.uuid() }),
  maxAttempts: 6,
  handle: async ({ messageId }, ctx) => {
    if (!ctx.workspaceId) throw new Error('whatsapp.send requires a workspace');
    await deliverMessage(ctx.workspaceId, messageId, ctx);
  },
});
