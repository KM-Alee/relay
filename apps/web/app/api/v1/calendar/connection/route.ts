// GET /api/v1/calendar/connection: my Google Calendar status. DELETE: disconnect (revoke + wipe). (I3.1, I3.2)
import { calendarService } from '@relay/core/services/calendar';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'appointments.manage',
  handler: ({ actor }) => calendarService.connectionStatus(actor),
});

export const DELETE = route({
  auth: 'session',
  permission: 'appointments.manage',
  handler: ({ actor }) => calendarService.disconnect(actor),
});
