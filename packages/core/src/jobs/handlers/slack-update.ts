// slack.update: chat.update an alert, or DM a confirmation (link). 3 attempts (04 §7).
import { z } from 'zod';
import { sendSlackUpdate } from '../../services/slack';
import { defineJob } from '../types';

export const slackUpdateJob = defineJob({
  type: 'slack.update',
  payload: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('alert'), alertId: z.string(), text: z.string().max(1000) }),
    z.object({ kind: z.literal('dm'), slackUserId: z.string(), text: z.string().max(1000) }),
  ]),
  handle: async (p, ctx) => {
    if (!ctx.workspaceId) throw new Error('slack.update requires a workspace');
    await sendSlackUpdate(ctx.workspaceId, p);
  },
});
