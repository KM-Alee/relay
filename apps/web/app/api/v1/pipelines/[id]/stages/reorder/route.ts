// POST /api/v1/pipelines/:id/stages/reorder.
import { idParams, stageReorderInput } from '@relay/contracts/api/crm';
import { pipelinesService } from '@relay/core/services/crm-pipelines';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.config.manage',
  params: idParams,
  body: stageReorderInput,
  handler: ({ actor, params, body }) => pipelinesService.reorderStages(actor, params.id, body.stageIds),
});
