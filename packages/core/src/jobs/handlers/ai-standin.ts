// ai.standin_reply / ai.handoff (F6.2, F6.10; 04 §7). Owner: Lane A (glue in services/ai-standin.ts).
// The AI never acknowledges, owns or stops timers: these jobs call no lead transition.
import { z } from 'zod';
import { runHandoff, runStandIn } from '../../services/ai-standin';
import { defineJob } from '../types';

export const aiStandinReplyJob = defineJob({
  type: 'ai.standin_reply',
  payload: z.object({ leadId: z.uuid(), conversationId: z.uuid(), messageId: z.uuid() }),
  maxAttempts: 3,
  handle: async (p, ctx) => {
    if (!ctx.workspaceId) return;
    await runStandIn(ctx.workspaceId, p);
  },
});

export const aiHandoffJob = defineJob({
  type: 'ai.handoff',
  payload: z.object({ leadId: z.uuid(), reason: z.string().max(40) }),
  maxAttempts: 3,
  handle: async (p, ctx) => {
    if (!ctx.workspaceId) return;
    await runHandoff(ctx.workspaceId, p);
  },
});
