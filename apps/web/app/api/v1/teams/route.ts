// GET /api/v1/teams (team.availability.view): teams, members, live availability (F3.2). Lane A.
import { teamsService } from '@relay/core/services/teams';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'team.availability.view',
  handler: ({ actor }) => teamsService.list(actor),
});
