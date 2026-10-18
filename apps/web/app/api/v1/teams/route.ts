// GET /api/v1/teams (team.availability.view): teams, members, live availability (F3.2). Lane A.
// POST /api/v1/teams (routing.manage): create a team (T-202).
import { createTeamInput } from '@relay/contracts/api/automations';
import { teamsService } from '@relay/core/services/teams';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'team.availability.view',
  handler: ({ actor }) => teamsService.list(actor),
});

export const POST = route({
  auth: 'session',
  permission: 'routing.manage',
  body: createTeamInput,
  status: 201,
  handler: ({ actor, body }) => teamsService.create(actor, body),
});
