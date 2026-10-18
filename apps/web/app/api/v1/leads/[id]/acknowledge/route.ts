// POST /api/v1/leads/:id/acknowledge {version?}: T2, owner in handler custody only. Lane A.
// Not owner / already acked / stale → 409 LEAD_STATE_CHANGED (details.currentOwnerUserId).
import { acknowledgeInput, leadIdParams } from '@relay/contracts/api/leads';
import { leadsService } from '@relay/core/services/leads';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  params: leadIdParams,
  body: acknowledgeInput,
  handler: async ({ actor, params, body }) => {
    const lead = await leadsService.acknowledge(actor, params.id, { version: body.version, via: 'app' });
    kickDueWork();
    return lead;
  },
});
