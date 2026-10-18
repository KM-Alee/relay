// PATCH /api/v1/teams/:id (routing.manage): members, backup + manager, capacity, routing settings. Lane A.
import { teamIdParams, updateTeamInput } from '@relay/contracts/api/automations';
import { teamsService } from '@relay/core/services/teams';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  permission: 'routing.manage',
  params: teamIdParams,
  body: updateTeamInput,
  handler: ({ actor, params, body }) => teamsService.update(actor, params.id, body),
});
