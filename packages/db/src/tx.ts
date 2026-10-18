// Transaction helpers: the ONLY way runtime code touches the database (AGENTS.md rule 4, 06 §3).
//
// Workspace context is TRANSACTION-LOCAL: `set_config('app.workspace_id', $1, true)`. It survives
// Neon's PgBouncer transaction pooling and vanishes at COMMIT/ROLLBACK. Never use plain `SET`,
// `set_config(..., false)`, LISTEN/NOTIFY or session advisory locks.
import { sql } from 'drizzle-orm';
import { getDb, type Db } from './client';

/** A Drizzle transaction handle. Repos take `tx: Tx` as their first argument. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TxOptions {
  /** Override the database (tests). Defaults to the shared runtime pool. */
  db?: Db;
}

/** Run `fn` in one transaction scoped to `workspaceId`. RLS policies read `app.workspace_id`. */
export async function withWorkspaceTx<T>(
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: TxOptions = {},
): Promise<T> {
  // Never trust the caller blindly: a malformed id would otherwise surface as a SQL cast error.
  if (!UUID_RE.test(workspaceId)) throw new Error('withWorkspaceTx: workspaceId must be a UUID');
  const db = opts.db ?? getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

/**
 * Transaction WITHOUT workspace context. Workspace-scoped tables return 0 rows here (RLS fails
 * closed). Use it only for global tables (rate_limits, scheduler_state, job_runs, test_results)
 * and SECURITY DEFINER functions (auth_resolve_session, claim_due_*), then switch to
 * withWorkspaceTx once the workspace is known.
 */
export async function withSystemTx<T>(fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const db = opts.db ?? getDb();
  return db.transaction(async (tx) => {
    // Defensive: make sure no stale context can leak in from a reused pooled connection.
    await tx.execute(sql`select set_config('app.workspace_id', '', true)`);
    return fn(tx);
  });
}
