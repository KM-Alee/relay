// pnpm db:seed → runs seed/index.ts against DATABASE_URL_UNPOOLED (owner role). Idempotent.
// Refuses non-local hosts unless ALLOW_REMOTE_SEED=1 (e.g. a Neon preview branch).
import { requireEnv } from './env';
import { createDb } from '../src/client';
import { isLocalDatabaseUrl } from '../src/migrate';
import { runSeeds } from '../seed/index';

const url = requireEnv('DATABASE_URL_UNPOOLED');
if (!isLocalDatabaseUrl(url) && process.env.ALLOW_REMOTE_SEED !== '1') {
  console.error('Refusing to seed a non-local database (set ALLOW_REMOTE_SEED=1 for a preview branch).');
  process.exit(1);
}
const { db, pool } = createDb({ connectionString: url, max: 1 });
try {
  await runSeeds({ db, log: (m) => console.log(m) });
  console.log('seed: done');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
