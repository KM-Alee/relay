// GET /api/v1/calendar/team: every active employee's calendar status + why they cannot be booked (I3.7).
import { calendarService } from '@relay/core/services/calendar';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  handler: ({ actor }) => calendarService.team(actor),
});
