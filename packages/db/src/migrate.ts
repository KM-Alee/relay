// Relay SQL migration runner (docs/10-conventions.md §4, docs/13-parallel-development.md §3).
//
// - Applies `packages/db/migrations/<YYYYMMDDHHmm>_<lane>_<slug>.sql` in FILENAME order.
// - Records each applied file + sha256 checksum in `schema_migrations`. Editing an applied file is an
//   error ("never edit a merged migration"). Files merged later with an older timestamp (parallel
//   lanes) are still applied.
// - Runs as the OWNER role over the UNPOOLED url (DATABASE_URL_UNPOOLED), never as app_user.
// - Each file runs in its own transaction holding a transaction-scoped advisory lock, so two runners
//   (e.g. two preview builds) never apply the same file twice. A file whose first line contains
//   `-- relay:no-transaction` runs outside a transaction (e.g. CREATE INDEX CONCURRENTLY).
// - `relay.app_db_password` is set transaction-locally from APP_DB_PASSWORD so the roles migration
//   can give app_user a password without it ever living in a file.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../migrations');
export const MIGRATION_FILE_RE = /^\d{12}_[a-z0-9]+_[a-z0-9][a-z0-9_-]*\.sql$/;
const LOCK_KEY = 72_917_001; // arbitrary, constant: "relay migrations"

export interface RunMigrationsOptions {
  /** Owner / unpooled connection string. */
  connectionString: string;
  dir?: string;
  /** Password the roles migration sets for app_user (APP_DB_PASSWORD). Optional. */
  appDbPassword?: string;
  log?: (msg: string) => void;
}

export interface MigrationResult {
  applied: string[];
  skipped: number;
}

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
  noTransaction: boolean;
}

export async function listMigrationFiles(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  const bad = names.filter((n) => !MIGRATION_FILE_RE.test(n));
  if (bad.length) {
    throw new Error(
      `Invalid migration filename(s): ${bad.join(', ')}. Expected <YYYYMMDDHHmm>_<lane>_<slug>.sql`,
    );
  }
  return Promise.all(
    names.map(async (name) => {
      const sql = (await readFile(path.join(dir, name), 'utf8')).replace(/\r\n/g, '\n');
      return {
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
        noTransaction: /^--\s*relay:no-transaction/.test(sql),
      };
    }),
  );
}

/** Serialization/deadlock or concurrent catalog update: safe to retry the whole migration tx. */
function isTransientCatalogError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return (
    e.code === '40001' || e.code === '40P01' || /tuple concurrently (updated|deleted)/.test(e.message ?? '')
  );
}

async function applyInTransaction(
  client: pg.Client,
  file: MigrationFile,
  appDbPassword: string | undefined,
): Promise<'applied' | 'skipped'> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    // Another runner may have applied it while we waited for the lock.
    const again = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file.name]);
    if (again.rowCount) {
      await client.query('ROLLBACK');
      return 'skipped';
    }
    await client.query("SELECT set_config('relay.app_db_password', $1, true)", [appDbPassword ?? '']);
    await client.query(file.sql);
    await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
      file.name,
      file.checksum,
    ]);
    await client.query('COMMIT');
    return 'applied';
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

export async function runMigrations(opts: RunMigrationsOptions): Promise<MigrationResult> {
  const log = opts.log ?? (() => undefined);
  const files = await listMigrationFiles(opts.dir);
  const client = new pg.Client({ connectionString: opts.connectionString });
  await client.connect();
  const applied: string[] = [];
  let skipped = 0;
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations',
    );
    const known = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const file of files) {
      const prev = known.get(file.name);
      if (prev !== undefined) {
        if (prev !== file.checksum) {
          throw new Error(
            `Migration ${file.name} was edited after it was applied. Never edit a merged migration; add a new one.`,
          );
        }
        skipped++;
        continue;
      }
      if (file.noTransaction) {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          file.name,
          file.checksum,
        ]);
      } else {
        // Retry transient errors: cluster-global catalogs (e.g. ALTER ROLE app_user in the roles
        // migration) are shared by every database on the server, so two worktrees migrating their own
        // DBs at the same moment can hit "tuple concurrently updated" (13 §6). The tx rolls back cleanly.
        let outcome: 'applied' | 'skipped' | undefined;
        for (let attempt = 1; outcome === undefined; attempt++) {
          try {
            outcome = await applyInTransaction(client, file, opts.appDbPassword);
          } catch (err) {
            if (attempt < 6 && isTransientCatalogError(err)) {
              await new Promise((r) => setTimeout(r, 50 * attempt + Math.random() * 100));
              continue;
            }
            throw new Error(`Migration ${file.name} failed: ${(err as Error).message}`, { cause: err });
          }
        }
        if (outcome === 'skipped') {
          skipped++;
          continue;
        }
      }
      applied.push(file.name);
      log(`applied ${file.name}`);
    }
  } finally {
    await client.end();
  }
  return { applied, skipped };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db', 'postgres']);

export function isLocalDatabaseUrl(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

export function databaseNameOf(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unsupported database name in URL: "${name}"`);
  return name;
}

/** Same server/credentials as `url`, different database. */
export function withDatabaseName(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** CREATE DATABASE if it does not exist (connects to the `postgres` maintenance DB). */
export async function ensureDatabase(ownerUrl: string): Promise<boolean> {
  const name = databaseNameOf(ownerUrl);
  const admin = new pg.Client({ connectionString: withDatabaseName(ownerUrl, 'postgres') });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount) return false;
    try {
      await admin.query(`CREATE DATABASE "${name}"`); // name validated above
    } catch (err) {
      // Two test runs racing to create the same DB.
      if ((err as { code?: string }).code !== '42P04') throw err;
      return false;
    }
    return true;
  } finally {
    await admin.end();
  }
}

/** DROP + CREATE a local database. Refuses non-local hosts. */
export async function recreateLocalDatabase(ownerUrl: string): Promise<void> {
  if (!isLocalDatabaseUrl(ownerUrl)) {
    throw new Error(`Refusing to reset a non-local database (${new URL(ownerUrl).hostname}).`);
  }
  const name = databaseNameOf(ownerUrl);
  const admin = new pg.Client({ connectionString: withDatabaseName(ownerUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}
