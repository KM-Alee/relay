// slack.send: Block Kit alert DM (04 §6/§7). Pure function of payload + adapter; retries/backoff come from the runner.
import { z } from 'zod';
import { sendSlackAlert } from '../../services/slack';
import { defineJob } from '../types';

export const slackSendJob = defineJob({
  type: 'slack.send',
  payload: z.object({
    alertId: z.string(),
    leadId: z.uuid(),
    userId: z.uuid(),
    purpose: z.enum(['assigned', 'escalated', 'critical', 'fallback']),
    leadVersion: z.number().int(),
    leadName: z.string().max(200),
    source: z.string().max(100),
    reason: z.string().max(500),
    level: z.number().int().nullable(),
    deadlineAt: z.iso.datetime({ offset: true }).nullable(),
    valueText: z.string().max(100).nullable(),
  }),
  handle: async (p, ctx) => {
    if (!ctx.workspaceId) throw new Error('slack.send requires a workspace');
    await sendSlackAlert(ctx.workspaceId, p, ctx.now);
  },
});
