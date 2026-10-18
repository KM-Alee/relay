// calendar + appointments API contracts (docs/11-api.md, I3.1-I3.7). Owner: Lane C (T-144).
import { z } from 'zod';
import { endpoint } from './endpoint';

const iso = z.iso.datetime({ offset: true });
const iana = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/, 'IANA time zone');

export const calendarStatusSchema = z.enum(['not_connected', 'connected', 'needs_reconnect', 'error']);
export const notBookableReasonSchema = z.enum(['no_calendar_connected', 'needs_reconnect', 'calendar_error']);
export type NotBookableReason = z.infer<typeof notBookableReasonSchema>;

export const calendarConnectionDto = z.object({
  status: calendarStatusSchema,
  email: z.string().nullable(),
  lastOkAt: iso.nullable(),
  lastError: z.string().nullable(),
  /** Google OAuth is configured on this deployment at all. */
  available: z.boolean(),
});
export type CalendarConnectionDto = z.infer<typeof calendarConnectionDto>;

export const calendarTeamMember = z.object({
  userId: z.uuid(),
  name: z.string(),
  status: calendarStatusSchema,
  email: z.string().nullable(),
  bookable: z.boolean(),
  /** Why the employee cannot be booked (I3.7). */
  reason: notBookableReasonSchema.nullable(),
});
export const calendarTeamResponse = z.object({ members: z.array(calendarTeamMember) });

export const busyBlock = z.object({
  start: iso,
  end: iso,
  source: z.enum(['google', 'relay']),
});
export const availabilityQuery = z.object({ from: iso, to: iso });
export const availabilityResponse = z.object({
  userId: z.uuid(),
  bookable: z.boolean(),
  reason: notBookableReasonSchema.nullable(),
  /** True when Google could not be reached: only Relay's own appointments are shown. */
  partial: z.boolean(),
  busy: z.array(busyBlock),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponse>;

export const appointmentDto = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  contactId: z.uuid().nullable(),
  opportunityId: z.uuid().nullable(),
  leadId: z.uuid().nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  startsAt: iso,
  endsAt: iso,
  /** IANA zone the appointment was booked in (I3.5). */
  timezone: z.string(),
  status: z.enum(['scheduled', 'cancelled']),
  syncStatus: z.enum(['pending', 'synced', 'failed']),
  htmlLink: z.string().nullable(),
  version: z.number().int(),
});
export type AppointmentDto = z.infer<typeof appointmentDto>;

export const createAppointmentInput = z.object({
  /** Whose calendar. Defaults to the caller. */
  userId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  opportunityId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).optional(),
  attendeeEmail: z.email().optional(),
  startsAt: iso,
  endsAt: iso,
  timezone: iana,
  /** Book despite a conflict (needs appointments.override). */
  override: z.boolean().optional(),
});
export type CreateAppointmentInput = z.input<typeof createAppointmentInput>;

export const rescheduleAppointmentInput = z.object({
  version: z.number().int(),
  startsAt: iso,
  endsAt: iso,
  timezone: iana,
  title: z.string().trim().min(1).max(200).optional(),
  override: z.boolean().optional(),
});
export type RescheduleAppointmentInput = z.input<typeof rescheduleAppointmentInput>;
export const cancelAppointmentInput = z.object({ version: z.number().int() });

export const appointmentsQuery = z.object({
  from: iso.optional(),
  to: iso.optional(),
  userId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  opportunityId: z.uuid().optional(),
});
export const appointmentsResponse = z.object({ appointments: z.array(appointmentDto) });

const idParams = z.object({ id: z.uuid() });
const userParams = z.object({ userId: z.uuid() });

export const calendarEndpoints = {
  connection: endpoint({
    method: 'GET',
    path: '/api/v1/calendar/connection',
    response: calendarConnectionDto,
  }),
  disconnect: endpoint({
    method: 'DELETE',
    path: '/api/v1/calendar/connection',
    response: z.object({ ok: z.literal(true) }),
  }),
  team: endpoint({ method: 'GET', path: '/api/v1/calendar/team', response: calendarTeamResponse }),
  availability: endpoint({
    method: 'GET',
    path: '/api/v1/calendar/:userId/availability',
    params: userParams,
    query: availabilityQuery,
    response: availabilityResponse,
  }),
  list: endpoint({
    method: 'GET',
    path: '/api/v1/appointments',
    query: appointmentsQuery,
    response: appointmentsResponse,
  }),
  create: endpoint({
    method: 'POST',
    path: '/api/v1/appointments',
    body: createAppointmentInput,
    response: appointmentDto,
  }),
  reschedule: endpoint({
    method: 'PATCH',
    path: '/api/v1/appointments/:id',
    params: idParams,
    body: rescheduleAppointmentInput,
    response: appointmentDto,
  }),
  cancel: endpoint({
    method: 'POST',
    path: '/api/v1/appointments/:id/cancel',
    params: idParams,
    body: cancelAppointmentInput,
    response: appointmentDto,
  }),
} as const;
