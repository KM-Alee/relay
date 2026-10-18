// Audit contracts (docs/06-security.md §6, docs/11-api.md). Owner: Lane B.
// T-007: verify integrity (F4.4). The list endpoint (GET /api/v1/audit, F4.2) arrives with T-151.
import { z } from 'zod';
import { endpoint } from './endpoint';

export const auditActorTypeSchema = z.enum(['user', 'system', 'ai']);

/** Result of recomputing the per-workspace hash chain (F4.4). Hashes are lowercase hex. */
export const auditVerifyResponse = z.object({
  ok: z.boolean(),
  /** Rows checked (all rows of the workspace when ok; up to and including the broken one otherwise). */
  checked: z.number().int().nonnegative(),
  /** First seq whose content hash, previous-hash link or sequence number does not match. */
  firstBrokenSeq: z.number().int().positive().nullable(),
  expectedHash: z.string().nullable(),
  storedHash: z.string().nullable(),
});
export type AuditVerifyResponse = z.infer<typeof auditVerifyResponse>;

// ── List (F4.2, T-151) ──────────────────────────────────────────────────
export const auditEventDto = z.object({
  id: z.number().int(),
  seq: z.number().int(),
  occurredAt: z.iso.datetime({ offset: true }),
  actorType: auditActorTypeSchema,
  actorUserId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  meta: z.unknown().nullable(),
});
export type AuditEventDto = z.infer<typeof auditEventDto>;

export const auditListQuery = z
  .object({
    /** Exact action ('user.invited') or an entity prefix ('user'). */
    type: z
      .string()
      .regex(/^[a-z_]+(\.[a-z_]+)?$/)
      .optional(),
    userId: z.uuid().optional(),
    /** ISO dates/datetimes; `to` is inclusive of the whole day when a bare date is given. */
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
    /** Keyset: return events with seq below this (newest first). */
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export const auditListResponse = z.object({
  items: z.array(auditEventDto),
  nextCursor: z.number().int().nullable(),
});
export type AuditListResponse = z.infer<typeof auditListResponse>;

export const auditEndpoints = {
  /** GET /api/v1/audit (perm audit.view): newest first, filter by type/user/date. Read-only (F4.3). */
  list: endpoint({
    method: 'GET',
    path: '/api/v1/audit',
    query: auditListQuery,
    response: auditListResponse,
  }),
  /** POST /api/v1/audit/verify (perm audit.view): recompute the chain, report the first broken link. */
  verify: endpoint({ method: 'POST', path: '/api/v1/audit/verify', response: auditVerifyResponse }),
} as const;
