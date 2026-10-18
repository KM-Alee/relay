// integration.process: dispatch a recorded inbound event by provider (04 §7). Idempotent by status.
import { withSystemTx, withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { processStripeEvent } from '../../services/payments';
import { processSlackEvent } from '../../services/slack';
import { defineJob } from '../types';

export const integrationProcessJob = defineJob({
  type: 'integration.process',
  payload: z.object({ eventId: z.uuid() }),
  handle: async ({ eventId }, ctx) => {
    const read = (tx: Tx) =>
      tx.execute<{ provider: string }>(sql`select provider from integration_events where id = ${eventId}`);
    const r = await (ctx.workspaceId ? withWorkspaceTx(ctx.workspaceId, read) : withSystemTx(read));
    // Other providers (Meta T-141, Google T-144 has none) add their branch here.
    const provider = r.rows[0]?.provider;
    if (provider === 'slack') await processSlackEvent(eventId, ctx.workspaceId);
    else if (provider === 'stripe') await processStripeEvent(eventId, ctx.workspaceId);
  },
});
