// PATCH /api/v1/users/:id/availability: self or team.availability.manage (F3.2). Lane A.
// On leave / Offline reassigns the user's PENDING leads in the same tx (F3.6, 03 T5).
import { availabilityParams, setAvailabilityInput } from '@relay/contracts/api/teams';
import { teamsService } from '@relay/core/services/teams';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  params: availabilityParams,
  body: setAvailabilityInput,
  handler: async ({ actor, params, body }) => {
    const r = await teamsService.setAvailability(actor, params.id, body.availability);
    kickDueWork();
    return r;
  },
});
