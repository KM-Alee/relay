// media.download: Graph media id -> bytes -> Blob (or Postgres fallback) -> media row linked to the message (I1.11).
import { z } from 'zod';
import { downloadInboundMedia } from '../../services/messaging';
import { defineJob } from '../types';

export const mediaDownloadJob = defineJob({
  type: 'media.download',
  payload: z.object({
    messageId: z.uuid(),
    providerMediaId: z.string().min(1).max(200),
    mime: z.string().max(200).nullable(),
    filename: z.string().max(300).nullable(),
  }),
  maxAttempts: 5,
  handle: async (p, ctx) => {
    if (!ctx.workspaceId) throw new Error('media.download requires a workspace');
    await downloadInboundMedia(ctx.workspaceId, p);
  },
});
