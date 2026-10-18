// lead.retry_routing {teamId}: T4 for every awaiting lead of the team (03 T4, 04 §7). Owner: Lane A.
// Kicked when someone becomes Available, a lead closes, or capacity changes. Idempotent: each lead is
// re-locked and re-checked; a lead that is no longer awaiting is skipped by the domain guard.
import { z } from 'zod';
import { retryTeam } from '../../services/leads';
import { defineJob } from '../types';

export const leadRetryRoutingJob = defineJob({
  type: 'lead.retry_routing',
  payload: z.object({ teamId: z.uuid() }),
  handle: async ({ teamId }, ctx) => {
    if (!ctx.workspaceId) return;
    await retryTeam(ctx.workspaceId, teamId);
  },
});
