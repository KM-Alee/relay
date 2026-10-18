// GET /api/v1/opportunities/:id/timeline (F2.7).
import { idParams, timelineQuery } from '@relay/contracts/api/crm';
import { crmActivityService } from '@relay/core/services/crm-activity';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.opportunity.view',
  params: idParams,
  query: timelineQuery,
  handler: ({ actor, params, query }) => crmActivityService.opportunityTimeline(actor, params.id, query),
});
