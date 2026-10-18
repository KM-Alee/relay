// calendar.create_event / update_event / cancel_event (04 §7). The handler drives Google to the appointment's
// CURRENT state with a deterministic event id, so a lease-expiry re-run is harmless. ProviderError{auth} ->
// failed + connection needs_reconnect (set by the service); temporary -> retried with backoff.
import { z } from 'zod';
import { syncAppointment, type SyncOp } from '../../services/calendar';
import { defineJob } from '../types';

const payload = z.object({ appointmentId: z.uuid(), version: z.number().int() });

const make = (type: string, op: SyncOp) =>
  defineJob({
    type,
    payload,
    handle: async ({ appointmentId }, ctx) => {
      if (!ctx.workspaceId) throw new Error(`${type} requires a workspace`);
      await syncAppointment(ctx.workspaceId, appointmentId, op, ctx.now);
    },
  });

export const calendarCreateEventJob = make('calendar.create_event', 'create');
export const calendarUpdateEventJob = make('calendar.update_event', 'update');
export const calendarCancelEventJob = make('calendar.cancel_event', 'cancel');
