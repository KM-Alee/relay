// api.messaging.*: owner Lane C. One method per endpoint in contracts/api/messaging.ts; pattern: ./users.ts.
import { messagingEndpoints as e } from '@relay/contracts/api/messaging';
import { messagingFixtures as fx } from '@relay/contracts/fixtures/messaging';
import { call, type CallInput, type CallOptions } from '../http';

export const messaging = {
  list: (input: CallInput<typeof e.list>, opts?: CallOptions) =>
    call('messaging', e.list, input, () => fx.list(), opts),
  messages: (input: CallInput<typeof e.messages>, opts?: CallOptions) =>
    call('messaging', e.messages, input, () => fx.messages(), opts),
  send: (input: CallInput<typeof e.send>, opts?: CallOptions) =>
    call('messaging', e.send, input, () => fx.send(), opts),
  retry: (input: CallInput<typeof e.retry>, opts?: CallOptions) =>
    call('messaging', e.retry, input, () => fx.retry(), opts),
  markRead: (input: CallInput<typeof e.markRead>, opts?: CallOptions) =>
    call('messaging', e.markRead, input, () => fx.markRead(), opts),
  optOut: (input: CallInput<typeof e.optOut>, opts?: CallOptions) =>
    call('messaging', e.optOut, input, () => fx.optOut(), opts),
  templates: (opts?: CallOptions) => call('messaging', e.templates, {}, () => fx.templates(), opts),
};
