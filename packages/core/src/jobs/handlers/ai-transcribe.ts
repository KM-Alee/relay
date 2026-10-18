// ai.transcribe: voice note -> transcript + summary (T-217, F8.1). Provider failures are recorded on the
// message (failed + Retry), not retried blindly: the job only throws on infrastructure errors.
import { z } from 'zod';
import { transcribeMessage } from '../../services/voice';
import { defineJob } from '../types';

export const aiTranscribeJob = defineJob({
  type: 'ai.transcribe',
  payload: z.object({ messageId: z.uuid() }),
  maxAttempts: 3,
  handle: async (p, ctx) => {
    if (!ctx.workspaceId) throw new Error('ai.transcribe requires a workspace');
    await transcribeMessage(ctx.workspaceId, p.messageId);
  },
});
