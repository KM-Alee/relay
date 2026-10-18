// Used by `scripts/wt.sh rm --purge`: drops this worktree's DATABASE_URL / TEST_DATABASE_URL databases.
// Safety: local hosts only, and only names ending in a worktree suffix `_t<number>`.
import pg from 'pg';
import { databaseNameOf, isLocalDatabaseUrl, withDatabaseName } from '../src/migrate';
import './env';

const owner = process.env.DATABASE_URL_UNPOOLED ?? process.env.TEST_DATABASE_URL_UNPOOLED;
if (!owner || !isLocalDatabaseUrl(owner)) {
  console.error('drop-worktree-dbs: no local owner URL; nothing dropped');
  process.exit(0);
}
const names = new Set(
  [process.env.DATABASE_URL_UNPOOLED, process.env.TEST_DATABASE_URL, process.env.TEST_DATABASE_URL_UNPOOLED]
    .filter((u): u is string => !!u)
    .map(databaseNameOf)
    .filter((n) => /_t\d+$/.test(n)),
);
const client = new pg.Client({ connectionString: withDatabaseName(owner, 'postgres') });
await client.connect();
try {
  for (const n of names) {
    await client.query(`DROP DATABASE IF EXISTS "${n.replace(/"/g, '')}" WITH (FORCE)`);
    console.log(`dropped database ${n}`);
  }
} finally {
  await client.end();
}
