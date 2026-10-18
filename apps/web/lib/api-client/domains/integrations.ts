// api.integrations.*: owner Lane C. One method per endpoint in contracts/api/integrations.ts; pattern: ./users.ts.
import { integrationsEndpoints as e } from '@relay/contracts/api/integrations';
import { integrationsFixtures as fx } from '@relay/contracts/fixtures/integrations';
import { call, type CallInput, type CallOptions } from '../http';

export const integrations = {
  list: (opts?: CallOptions) => call('integrations', e.list, {}, () => fx.list(), opts),
  connect: (input: CallInput<typeof e.connect>, opts?: CallOptions) =>
    call('integrations', e.connect, input, () => fx.connect(), opts),
  disconnect: (input: CallInput<typeof e.disconnect>, opts?: CallOptions) =>
    call('integrations', e.disconnect, input, () => fx.disconnect(), opts),
  forceBreaker: (input: CallInput<typeof e.breaker>, opts?: CallOptions) =>
    call('integrations', e.breaker, input, () => fx.breaker(), opts),
  events: (input: CallInput<typeof e.events>, opts?: CallOptions) =>
    call('integrations', e.events, input, () => fx.events(), opts),
  slackLinkStatus: (opts?: CallOptions) =>
    call('integrations', e.slackLinkStatus, {}, () => fx.slackLinkStatus(), opts),
  slackLinkCreate: (opts?: CallOptions) =>
    call('integrations', e.slackLinkCreate, {}, () => fx.slackLinkCreate(), opts),
  slackLinkDelete: (opts?: CallOptions) =>
    call('integrations', e.slackLinkDelete, {}, () => fx.slackLinkDelete(), opts),
};
