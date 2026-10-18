// api.judge.*: owner Lane B (T-209). One method per endpoint in contracts/api/judge.ts (13 §4).
import { judgeEndpoints as e } from '@relay/contracts/api/judge';
import { judgeFixtures as fx } from '@relay/contracts/fixtures/judge';
import { call, type CallInput, type CallOptions } from '../http';

export const judge = {
  list: (opts?: CallOptions) => call('judge', e.list, {}, () => fx.list(), opts),
  run: (input: CallInput<typeof e.run>, opts?: CallOptions) =>
    call('judge', e.run, input, () => fx.run(), opts),
};
