// Fixture builders for audit contracts (13 §4). Owner: Lane B. Pattern: ./users.ts.
import type { AuditVerifyResponse } from '../api/audit';

export function buildAuditVerify(overrides: Partial<AuditVerifyResponse> = {}): AuditVerifyResponse {
  return { ok: true, checked: 42, firstBrokenSeq: null, expectedHash: null, storedHash: null, ...overrides };
}

/** One entry per endpoint in auditEndpoints, used by the api-client in fixture mode. */
export const auditFixtures = {
  verify: () => buildAuditVerify(),
};
