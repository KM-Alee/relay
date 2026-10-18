// pnpm db:migrate  → applies migrations to DATABASE_URL_UNPOOLED (owner role).
// pnpm db:migrate --test → applies them to TEST_DATABASE_URL_UNPOOLED instead.
// Local hosts only: the database is created if missing (per-worktree DBs, docs/13 §6).
import { requireEnv } from './env';
import { ensureDatabase, isLocalDatabaseUrl, runMigrations } from '../src/migrate';

const url = requireEnv(
  process.argv.includes('--test') ? 'TEST_DATABASE_URL_UNPOOLED' : 'DATABASE_URL_UNPOOLED',
);
const where = `${new URL(url).hostname}/${new URL(url).pathname.slice(1)}`;

try {
  if (isLocalDatabaseUrl(url) && (await ensureDatabase(url))) console.log(`created database ${where}`);
  const res = await runMigrations({
    connectionString: url,
    appDbPassword: process.env.APP_DB_PASSWORD,
    log: (m) => console.log(m),
  });
  console.log(`migrations on ${where}: ${res.applied.length} applied, ${res.skipped} already applied`);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
