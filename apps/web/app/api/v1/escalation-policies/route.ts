// GET/POST /api/v1/escalation-policies (routing.manage): list + create (F3.5). Lane A.
import { createPolicyInput } from '@relay/contracts/api/automations';
import { policiesService } from '@relay/core/services/policies';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'routing.manage',
  handler: ({ actor }) => policiesService.list(actor),
});

export const POST = route({
  auth: 'session',
  permission: 'routing.manage',
  body: createPolicyInput,
  status: 201,
  handler: ({ actor, body }) => policiesService.create(actor, body),
});
