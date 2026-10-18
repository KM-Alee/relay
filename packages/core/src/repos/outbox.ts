// outbox data access (docs/02-data-model.md §8). Repos take `tx: Tx`; services/jobs open the tx.
// Runner reads/claims go through the SECURITY DEFINER functions of migration 202610181301_a_jobs.
// Outcome writes run under RLS in the row's own context (workspace tx, or system tx for NULL rows).
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';

export interface InsertOutboxRow {
  type: string;
  payload: unknown;
  dedupeKey?: string | null;
  /** Default: now() (DB clock). */
  availableAt?: Date | null;
  maxAttempts: number;
}

export interface ClaimedJob {
  id: string;
  workspaceId: string | null;
  type: string;
  payload: unknown;
  /** Attempt number of THIS claim (1-based). Fencing token for the outcome write. */
  attempt: number;
  maxAttempts: number;
  lockedUntil: Date;
}

export interface ClaimScope {
  types?: readonly string[] | null;
  workspaceIds?: readonly string[] | null;
}

/** Postgres array parameter (drizzle would otherwise expand a JS array into a tuple). */
const arr = (v: readonly string[] | null | undefined) => (v && v.length ? sql.param([...v]) : null);

/**
 * Insert one row. `workspace_id` comes from the transaction's `app.workspace_id` (NULL in a system
 * tx), so a caller can never enqueue into another workspace. A duplicate `dedupe_key` is a no-op.
 */
export async function insert(tx: Tx, row: InsertOutboxRow): Promise<{ id: string | null; deduped: boolean }> {
  const res = await tx.execute<{ id: string }>(sql`
    insert into outbox (workspace_id, type, payload, dedupe_key, available_at, max_attempts)
    values (
      nullif(current_setting('app.workspace_id', true), '')::uuid,
      ${row.type},
      ${JSON.stringify(row.payload ?? {})}::jsonb,
      ${row.dedupeKey ?? null},
      coalesce(${row.availableAt ?? null}::timestamptz, now()),
      ${row.maxAttempts}
    )
    on conflict (dedupe_key) do nothing
    returning id
  `);
  const id = res.rows[0]?.id ?? null;
  return { id, deduped: id === null };
}

/** Claim ≤ limit due rows (pending, or in-flight with an expired lease). Commit before delivering. */
export async function claim(
  tx: Tx,
  opts: { limit: number; leaseSeconds: number } & ClaimScope,
): Promise<ClaimedJob[]> {
  const res = await tx.execute<{
    id: string;
    workspace_id: string | null;
    type: string;
    payload: unknown;
    attempts: number;
    max_attempts: number;
    locked_until: Date | string;
  }>(sql`
    select * from relay_outbox_claim(
      ${opts.limit}::int, ${opts.leaseSeconds}::int, ${arr(opts.types)}::text[], ${arr(opts.workspaceIds)}::uuid[])
  `);
  return res.rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    type: r.type,
    payload: r.payload,
    attempt: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    lockedUntil: new Date(r.locked_until),
  }));
}

/** Earliest time a matching row becomes due, or null. */
export async function nextDue(tx: Tx, scope: ClaimScope = {}): Promise<Date | null> {
  const res = await tx.execute<{ at: Date | string | null }>(
    sql`select relay_outbox_next_due(${arr(scope.types)}::text[], ${arr(scope.workspaceIds)}::uuid[]) as at`,
  );
  const at = res.rows[0]?.at;
  return at ? new Date(at) : null;
}

// Outcome writes are FENCED on (status = 'in_flight', attempts = the claim's attempt): if our lease
// expired and another tick reclaimed the row, a late outcome from the stale worker changes nothing.

export async function markDone(tx: Tx, id: string, attempt: number): Promise<boolean> {
  const res = await tx.execute(sql`
    update outbox set status = 'done', locked_until = null, done_at = now()
     where id = ${id} and status = 'in_flight' and attempts = ${attempt}
  `);
  return (res.rowCount ?? 0) === 1;
}

export async function markRetry(
  tx: Tx,
  id: string,
  attempt: number,
  opts: { availableAt: Date; error: string; consumeAttempt: boolean },
): Promise<boolean> {
  const res = await tx.execute(sql`
    update outbox
       set status = 'pending', locked_until = null, available_at = ${opts.availableAt}::timestamptz,
           last_error = ${opts.error},
           attempts = case when ${opts.consumeAttempt}::boolean then attempts else greatest(attempts - 1, 0) end
     where id = ${id} and status = 'in_flight' and attempts = ${attempt}
  `);
  return (res.rowCount ?? 0) === 1;
}

export async function markFinal(
  tx: Tx,
  id: string,
  attempt: number,
  opts: { status: 'failed' | 'dead'; error: string },
): Promise<boolean> {
  const res = await tx.execute(sql`
    update outbox set status = ${opts.status}, locked_until = null, done_at = now(), last_error = ${opts.error}
     where id = ${id} and status = 'in_flight' and attempts = ${attempt}
  `);
  return (res.rowCount ?? 0) === 1;
}

/** Delete finished rows (done after `doneSeconds`, failed/dead after `deadSeconds`). */
export async function prune(tx: Tx, doneSeconds: number, deadSeconds: number): Promise<number> {
  const res = await tx.execute<{ n: number }>(
    sql`select relay_outbox_prune(${doneSeconds}::int, ${deadSeconds}::int) as n`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

export interface OutboxCounts {
  pending: number;
  in_flight: number;
  done: number;
  failed: number;
  dead: number;
}

/** Status counts visible in the current context (RLS: own workspace, or system rows). */
export async function countByStatus(tx: Tx): Promise<OutboxCounts> {
  const res = await tx.execute<{ status: keyof OutboxCounts; n: number }>(
    sql`select status, count(*)::int as n from outbox group by status`,
  );
  const out: OutboxCounts = { pending: 0, in_flight: 0, done: 0, failed: 0, dead: 0 };
  for (const r of res.rows) out[r.status] = Number(r.n);
  return out;
}
