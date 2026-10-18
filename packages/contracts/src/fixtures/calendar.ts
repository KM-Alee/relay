// Fixture builders for calendar contracts (13 §4). Owner: Lane C. Deterministic and schema-valid.
import type { AppointmentDto, AvailabilityResponse, CalendarConnectionDto } from '../api/calendar';

const USER = '0192f3a0-0000-7000-8000-000000000d01';

export function buildAppointment(overrides: Partial<AppointmentDto> = {}): AppointmentDto {
  return {
    id: '0192f3a0-0000-7000-8000-000000000d02',
    userId: USER,
    contactId: null,
    opportunityId: null,
    leadId: null,
    title: 'Site visit',
    notes: null,
    startsAt: '2026-10-20T09:00:00.000Z',
    endsAt: '2026-10-20T09:30:00.000Z',
    timezone: 'Asia/Karachi',
    status: 'scheduled',
    syncStatus: 'synced',
    htmlLink: null,
    version: 0,
    ...overrides,
  };
}

export const calendarFixtures = {
  connection: (): CalendarConnectionDto => ({
    status: 'connected',
    email: 'agent@example.com',
    lastOkAt: '2026-10-18T10:00:00.000Z',
    lastError: null,
    available: true,
  }),
  disconnect: () => ({ ok: true as const }),
  team: () => ({
    members: [
      {
        userId: USER,
        name: 'Aisha',
        status: 'connected' as const,
        email: 'a@example.com',
        bookable: true,
        reason: null,
      },
    ],
  }),
  availability: (): AvailabilityResponse => ({
    userId: USER,
    bookable: true,
    reason: null,
    partial: false,
    busy: [{ start: '2026-10-20T09:00:00.000Z', end: '2026-10-20T10:00:00.000Z', source: 'google' }],
  }),
  list: () => ({ appointments: [buildAppointment()] }),
  create: () => buildAppointment(),
  reschedule: () => buildAppointment({ version: 1 }),
  cancel: () => buildAppointment({ status: 'cancelled', version: 1 }),
} as const;
