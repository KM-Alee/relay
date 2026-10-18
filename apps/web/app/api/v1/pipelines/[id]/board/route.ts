// GET /api/v1/pipelines/:id/board: kanban columns (counts/totals masked, F1.4).
import { idParams, boardQuery } from '@relay/contracts/api/crm';
import { pipelinesService } from '@relay/core/services/crm-pipelines';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.opportunity.view',
  params: idParams,
  query: boardQuery,
  handler: ({ actor, params, query }) => pipelinesService.board(actor, params.id, query),
});
