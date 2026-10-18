// appointment.confirm: localized WhatsApp booking confirmation (I3.9). Enqueued by createAppointment().
import { z } from 'zod';
import { sendBookingConfirmation } from '../../services/booking-confirmation';
import { defineJob } from '../types';

export const appointmentConfirmJob = defineJob({
  type: 'appointment.confirm',
  payload: z.object({ appointmentId: z.uuid() }),
  maxAttempts: 4,
  handle: async ({ appointmentId }, ctx) => {
    if (!ctx.workspaceId) throw new Error('appointment.confirm requires a workspace');
    await sendBookingConfirmation(ctx.workspaceId, appointmentId, ctx.now);
  },
});
