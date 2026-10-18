// PATCH /api/v1/appointments/:id: reschedule (version-checked; updates the Google event). (I3.6)
import { rescheduleAppointmentInput } from '@relay/contracts/api/calendar';
import { calendarService } from '@relay/core/services/calendar';
import { z } from 'zod';
import { route } from '@/lib/http/route';
import { kickDueWork } from '@/lib/jobs/kick';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  permission: 'appointments.manage',
  params: z.object({ id: z.uuid() }),
  body: rescheduleAppointmentInput,
  handler: async ({ actor, params, body }) => {
    const dto = await calendarService.rescheduleAppointment(actor, params.id, body);
    kickDueWork();
    return dto;
  },
});
