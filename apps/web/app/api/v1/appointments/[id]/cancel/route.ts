// POST /api/v1/appointments/:id/cancel: cancel (removes the Google event). (I3.6)
import { cancelAppointmentInput } from '@relay/contracts/api/calendar';
import { calendarService } from '@relay/core/services/calendar';
import { z } from 'zod';
import { route } from '@/lib/http/route';
import { kickDueWork } from '@/lib/jobs/kick';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'appointments.manage',
  params: z.object({ id: z.uuid() }),
  body: cancelAppointmentInput,
  handler: async ({ actor, params, body }) => {
    const dto = await calendarService.cancelAppointment(actor, params.id, body.version);
    kickDueWork();
    return dto;
  },
});
