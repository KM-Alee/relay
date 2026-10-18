// PUT /api/v1/escalation-policies/:id (routing.manage): publish a new version (versioned, audited). Lane A.
import { policyIdParams, updatePolicyInput } from '@relay/contracts/api/automations';
import { policiesService } from '@relay/core/services/policies';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PUT = route({
  auth: 'session',
  permission: 'routing.manage',
  params: policyIdParams,
  body: updatePolicyInput,
  handler: ({ actor, params, body }) => policiesService.publish(actor, params.id, body),
});
