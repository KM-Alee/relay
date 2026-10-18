// Runtime database client (docs/01-architecture.md §4, ADR-0005).
// - Connects with DATABASE_URL: Neon POOLED endpoint, role app_user (NOBYPASSRLS). Never the owner.
// - Created lazily on first use, so importing this module has no side effects (build/tests stay cheap).
// - Every query must run inside withWorkspaceTx / withSystemTx (./tx.ts). Repos never import this file.
import { attachDatabasePool } from '@vercel/functions';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;

interface DbState {
  pool: pg.Pool;
  db: Db;
}

let state: DbState | undefined;

export interface CreateDbOptions {
  connectionString: string;
  /** Pool size per function instance. 01 §4: 5. */
  max?: number;
}

export function createDb({ connectionString, max = 5 }: CreateDbOptions): DbState {
  const pool = new pg.Pool({ connectionString, max, idleTimeoutMillis: 10_000 });
  // Errors on idle clients (e.g. Neon scale-to-zero) must not crash the process.
  pool.on('error', () => undefined);
  return { pool, db: drizzle(pool, { schema }) };
}

function init(): DbState {
  if (state) return state;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (runtime pooled URL, role app_user). See .env.example.');
  }
  state = createDb({ connectionString });
  // Lets Vercel Fluid compute drain idle clients before an instance is suspended (01 §4).
  if (process.env.VERCEL) attachDatabasePool(state.pool);
  return state;
}

export function getPool(): pg.Pool {
  return init().pool;
}

export function getDb(): Db {
  return init().db;
}

/** Close the shared pool (tests, scripts). A later getDb() creates a new one. */
export async function closeDb(): Promise<void> {
  const s = state;
  state = undefined;
  if (s) await s.pool.end();
}
