// GET /api/v1/calendar/:userId/availability?from&to: busy blocks = Google free/busy + our own appointments (I3.4).
import { availabilityQuery } from '@relay/contracts/api/calendar';
import { calendarService } from '@relay/core/services/calendar';
import { z } from 'zod';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'appointments.manage',
  params: z.object({ userId: z.uuid() }),
  query: availabilityQuery,
  rateLimit: { name: 'calendar.availability', limit: 60, windowSeconds: 60, by: 'user' },
  handler: ({ actor, params, query }) =>
    calendarService.availability(actor, params.userId, new Date(query.from), new Date(query.to)),
});
