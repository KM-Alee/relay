// api.leads.*: owner Lane A. One method per endpoint in contracts/api/leads.ts; pattern: ./users.ts.
import { leadsEndpoints } from '@relay/contracts/api/leads';
import { leadsFixtures } from '@relay/contracts/fixtures/leads';
import { call, type CallOptions } from '../http';

export const leads = {
  /** Countdown reached 0: run due work now (the caller debounces once per lead). */
  tickNudge: (opts?: CallOptions) =>
    call('leads', leadsEndpoints.tickNudge, {}, () => leadsFixtures.tickNudge(), opts),
};
