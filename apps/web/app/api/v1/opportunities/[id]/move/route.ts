// POST /api/v1/opportunities/:id/move (F2.4, F2.5): required fields enforced server-side.
import { idParams, opportunityMoveInput } from '@relay/contracts/api/crm';
import { moveOpportunity } from '@relay/core/services/crm-pipelines';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.opportunity.edit',
  params: idParams,
  body: opportunityMoveInput,
  handler: ({ actor, params, body }) => moveOpportunity(actor, params.id, body),
});
