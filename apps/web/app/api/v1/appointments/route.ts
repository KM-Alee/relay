// GET /api/v1/appointments (week agenda) and POST (book) (I3.3). Permission: appointments.manage.
import { appointmentsQuery, createAppointmentInput } from '@relay/contracts/api/calendar';
import { calendarService } from '@relay/core/services/calendar';
import { route } from '@/lib/http/route';
import { kickDueWork } from '@/lib/jobs/kick';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'appointments.manage',
  query: appointmentsQuery,
  handler: ({ actor, query }) => calendarService.listAppointments(actor, query),
});

export const POST = route({
  auth: 'session',
  permission: 'appointments.manage',
  body: createAppointmentInput,
  rateLimit: { name: 'appointments.create', limit: 30, windowSeconds: 60, by: 'user' },
  status: 201,
  handler: async ({ actor, body }) => {
    const dto = await calendarService.createAppointment(actor, body);
    kickDueWork(); // push the Google event now; the outbox row is the retry safety net
    return dto;
  },
});
