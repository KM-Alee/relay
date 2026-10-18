// api.audit.*: owner Lane B. One method per endpoint in contracts/api/audit.ts (13 §4).
import { auditEndpoints } from '@relay/contracts/api/audit';
import { auditFixtures } from '@relay/contracts/fixtures/audit';
import { call, type CallOptions } from '../http';

export const audit = {
  verify: (opts?: CallOptions) =>
    call('audit', auditEndpoints.verify, {}, () => auditFixtures.verify(), opts),
};
