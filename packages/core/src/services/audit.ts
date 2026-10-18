// Audit service (docs/06-security.md §6, F4.2, F4.4). Owner: Lane B.
// T-007: verify integrity. T-151 adds the keyset-paginated list; T-220 the UI. No mutation exists.
import type { auditListQuery, AuditListResponse, AuditVerifyResponse } from '@relay/contracts/api/audit';
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import { verifyChain } from '../audit/index';
import type { Actor } from '../auth/actor';
import { maskValueFields } from '../auth/mask';
import { assertPermission } from '../auth/permissions';
import { AppError } from '../errors';
import * as repo from '../repos/team-admin';
import type { z } from 'zod';

/** POST /api/v1/audit/verify: recompute the caller's workspace chain (perm audit.view). */
export async function verify(actor: Actor, opts: TxOptions = {}): Promise<AuditVerifyResponse> {
  assertPermission(actor, 'audit.view');
  return withWorkspaceTx(actor.workspaceId, (tx) => verifyChain(tx, actor.workspaceId), opts);
}

const bad = (path: string) =>
  new AppError('VALIDATION_FAILED', { details: { in: 'query', issues: [{ path, code: 'invalid_date' }] } });

function parseBound(v: string | undefined, path: 'from' | 'to'): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw bad(path);
  // A bare date as the upper bound covers that whole day.
  return path === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(d.getTime() + 86_400_000 - 1) : d;
}

/**
 * GET /api/v1/audit (perm audit.view, F4.2): newest first, filter by event type / user / date, keyset by seq.
 * Read-only: there is no audit mutation endpoint anywhere (F4.3). Opportunity values inside diffs are
 * masked per the actor (core/auth/mask.ts).
 */
export async function list(
  actor: Actor,
  query: z.infer<typeof auditListQuery>,
  opts: TxOptions = {},
): Promise<AuditListResponse> {
  assertPermission(actor, 'audit.view');
  const limit = query.limit ?? 50;
  const rows = await withWorkspaceTx(
    actor.workspaceId,
    (tx) =>
      repo.listAudit(tx, actor.workspaceId, {
        type: query.type,
        userId: query.userId,
        from: parseBound(query.from, 'from'),
        to: parseBound(query.to, 'to'),
        cursor: query.cursor,
        limit,
      }),
    opts,
  );
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      ...r,
      occurredAt: r.occurredAt.toISOString(),
      before: maskValueFields(actor, r.before ?? null),
      after: maskValueFields(actor, r.after ?? null),
      meta: maskValueFields(actor, r.meta ?? null),
    })),
    nextCursor: rows.length > limit ? (page.at(-1)?.seq ?? null) : null,
  };
}

export const auditService = { verify, list };
