// POST /api/v1/leads/:id/take-over: the fallback custodian becomes the handler if eligible (03 §11 Q3). Lane A.
import { leadIdParams, takeOverInput } from '@relay/contracts/api/leads';
import { leadActionsService } from '@relay/core/services/lead-actions';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  params: leadIdParams,
  body: takeOverInput,
  handler: async ({ actor, params }) => {
    const lead = await leadActionsService.takeOver(actor, params.id);
    kickDueWork();
    return lead;
  },
});
