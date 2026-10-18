// GET /api/v1/recovery (leads.recovery.view): F3.7 queue, R1–R5 reasons, one recommended action. Lane A.
import { recoveryQuery } from '@relay/contracts/api/leads';
import { leadActionsService } from '@relay/core/services/lead-actions';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'leads.recovery.view',
  query: recoveryQuery,
  handler: ({ actor, query }) =>
    leadActionsService.recoveryList(actor, { reason: query.reason, mine: query.mine === '1' }),
});
