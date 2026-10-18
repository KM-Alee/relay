// Audit service (docs/06-security.md §6, F4.2, F4.4). Owner: Lane B.
// T-007: verify integrity. T-151 adds the keyset-paginated list; T-220 the UI. No mutation exists.
import type { AuditVerifyResponse } from '@relay/contracts/api/audit';
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import { verifyChain } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';

/** POST /api/v1/audit/verify: recompute the caller's workspace chain (perm audit.view). */
export async function verify(actor: Actor, opts: TxOptions = {}): Promise<AuditVerifyResponse> {
  assertPermission(actor, 'audit.view');
  return withWorkspaceTx(actor.workspaceId, (tx) => verifyChain(tx, actor.workspaceId), opts);
}

export const auditService = { verify };
