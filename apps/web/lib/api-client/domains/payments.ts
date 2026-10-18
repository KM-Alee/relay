// api.payments.*: owner Lane C. One method per endpoint in contracts/api/payments.ts; pattern: ./users.ts.
import { paymentsEndpoints as e } from '@relay/contracts/api/payments';
import { paymentsFixtures as fx } from '@relay/contracts/fixtures/payments';
import { call, type CallInput, type CallOptions } from '../http';

export const payments = {
  createLink: (input: CallInput<typeof e.createLink>, opts?: CallOptions) =>
    call('payments', e.createLink, input, () => fx.createLink(), opts),
  list: (input: CallInput<typeof e.list> = {}, opts?: CallOptions) =>
    call('payments', e.list, input, () => fx.list(), opts),
  sendWhatsapp: (input: CallInput<typeof e.sendWhatsapp>, opts?: CallOptions) =>
    call(
      'payments',
      e.sendWhatsapp,
      input,
      () => ({ ok: true as const, messageId: '00000000-0000-4000-8000-000000000001' }),
      opts,
    ),
  cancel: (input: CallInput<typeof e.cancel>, opts?: CallOptions) =>
    call('payments', e.cancel, input, () => fx.cancel(), opts),
};
