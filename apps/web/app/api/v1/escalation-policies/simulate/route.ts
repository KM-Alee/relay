// POST /api/v1/escalation-policies/simulate (routing.manage): dry-run a lead through the draft (no writes). Lane A.
import { simulateInput } from '@relay/contracts/api/automations';
import { policiesService } from '@relay/core/services/policies';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'routing.manage',
  body: simulateInput,
  handler: ({ actor, body }) => policiesService.simulate(actor, body),
});
