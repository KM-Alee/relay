// POST /api/v1/pipelines/:id/stages.
import { idParams, stageInput } from '@relay/contracts/api/crm';
import { pipelinesService } from '@relay/core/services/crm-pipelines';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.config.manage',
  params: idParams,
  body: stageInput,
  status: 201,
  handler: ({ actor, params, body }) => pipelinesService.addStage(actor, params.id, body),
});
