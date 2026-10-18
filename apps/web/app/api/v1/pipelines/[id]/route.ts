// PATCH/DELETE /api/v1/pipelines/:id.
import { idParams, pipelineUpdateInput } from '@relay/contracts/api/crm';
import { pipelinesService } from '@relay/core/services/crm-pipelines';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  permission: 'crm.config.manage',
  params: idParams,
  body: pipelineUpdateInput,
  handler: ({ actor, params, body }) => pipelinesService.update(actor, params.id, body),
});

export const DELETE = route({
  auth: 'session',
  permission: 'crm.config.manage',
  params: idParams,
  handler: ({ actor, params }) => pipelinesService.remove(actor, params.id),
});
