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

export const auditEndpoints = {
  /** POST /api/v1/audit/verify (perm audit.view): recompute the chain, report the first broken link. */
  verify: endpoint({ method: 'POST', path: '/api/v1/audit/verify', response: auditVerifyResponse }),
} as const;
