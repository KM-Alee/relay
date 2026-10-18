// GET /api/v1/leads/:id/reassign-targets (leads.reassign): who may receive the lead and why not. Lane A.
import { leadIdParams } from '@relay/contracts/api/leads';
import { leadActionsService } from '@relay/core/services/lead-actions';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'leads.reassign',
  params: leadIdParams,
  handler: ({ actor, params }) => leadActionsService.reassignTargets(actor, params.id),
});
