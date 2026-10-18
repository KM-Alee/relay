// api.calendar.*: owner Lane C. One method per endpoint in contracts/api/calendar.ts; pattern: ./users.ts.
import { calendarEndpoints as e } from '@relay/contracts/api/calendar';
import { calendarFixtures as fx } from '@relay/contracts/fixtures/calendar';
import { call, type CallInput, type CallOptions } from '../http';

export const calendar = {
  connection: (opts?: CallOptions) => call('calendar', e.connection, {}, () => fx.connection(), opts),
  disconnect: (opts?: CallOptions) => call('calendar', e.disconnect, {}, () => fx.disconnect(), opts),
  team: (opts?: CallOptions) => call('calendar', e.team, {}, () => fx.team(), opts),
  availability: (input: CallInput<typeof e.availability>, opts?: CallOptions) =>
    call('calendar', e.availability, input, () => fx.availability(), opts),
  list: (input: CallInput<typeof e.list> = {}, opts?: CallOptions) =>
    call('calendar', e.list, input, () => fx.list(), opts),
  create: (input: CallInput<typeof e.create>, opts?: CallOptions) =>
    call('calendar', e.create, input, () => fx.create(), opts),
  reschedule: (input: CallInput<typeof e.reschedule>, opts?: CallOptions) =>
    call('calendar', e.reschedule, input, () => fx.reschedule(), opts),
  cancel: (input: CallInput<typeof e.cancel>, opts?: CallOptions) =>
    call('calendar', e.cancel, input, () => fx.cancel(), opts),
};
