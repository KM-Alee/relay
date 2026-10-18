// PATCH/DELETE /api/v1/stages/:id. DELETE of a non-empty stage needs moveToStageId (F2.5).
import { idParams, stageUpdateInput, stageDeleteInput } from '@relay/contracts/api/crm';
import { pipelinesService } from '@relay/core/services/crm-pipelines';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  permission: 'crm.config.manage',
  params: idParams,
  body: stageUpdateInput,
  handler: ({ actor, params, body }) => pipelinesService.updateStage(actor, params.id, body),
});

export const DELETE = route({
  auth: 'session',
  permission: 'crm.config.manage',
  params: idParams,
  body: stageDeleteInput,
  handler: ({ actor, params, body }) => pipelinesService.deleteStage(actor, params.id, body),
});
