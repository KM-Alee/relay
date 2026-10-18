// GET/POST /api/v1/pipelines (F2.5).
import { pipelineInput } from '@relay/contracts/api/crm';
import { pipelinesService } from '@relay/core/services/crm-pipelines';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.opportunity.view',
  handler: ({ actor }) => pipelinesService.list(actor),
});

export const POST = route({
  auth: 'session',
  permission: 'crm.config.manage',
  body: pipelineInput,
  status: 201,
  handler: ({ actor, body }) => pipelinesService.create(actor, body),
});
