// GET /api/v1/opportunities/rotting (F2.9): open deals past their stage's rot period (recovery feed).
import { rottingQuery } from '@relay/contracts/api/crm-extras';
import { listRottingOpportunities } from '@relay/core/services/crm-rot';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.opportunity.view',
  query: rottingQuery,
  handler: ({ actor, query }) => listRottingOpportunities(actor, query),
});
