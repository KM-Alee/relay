// Fixture builders for audit contracts (13 §4). Owner: Lane B. Pattern: ./users.ts.
import type { AuditVerifyResponse } from '../api/audit';

export function buildAuditVerify(overrides: Partial<AuditVerifyResponse> = {}): AuditVerifyResponse {
  return { ok: true, checked: 42, firstBrokenSeq: null, expectedHash: null, storedHash: null, ...overrides };
}

/** One entry per endpoint in auditEndpoints, used by the api-client in fixture mode. */
export const auditFixtures = {
  list: () => ({
    items: [
      {
        id: 2,
        seq: 2,
        occurredAt: '2026-10-18T10:00:00.000Z',
        actorType: 'user' as const,
        actorUserId: '0192f3a0-0000-7000-8000-000000000101',
        actorName: 'Ayesha Khan',
        action: 'user.invited',
        targetType: 'invite',
        targetId: '0192f3a0-0000-7000-8000-000000000901',
        before: null,
        after: { baseLevel: 'user' },
        meta: null,
      },
    ],
    nextCursor: null,
  }),
  verify: () => buildAuditVerify(),
};
