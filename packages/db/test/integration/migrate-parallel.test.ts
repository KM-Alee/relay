// [Q14] Two worktrees migrating their OWN databases on the same server at the same time must both
// succeed: the real migrations touch cluster-global state (ALTER ROLE app_user), docs/13 §6.
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureDatabase, runMigrations, withDatabaseName } from '../../src/migrate';
import { testDbUrls } from '../db-urls';

const { ownerUrl, appUrl, database } = testDbUrls();
const names = [1, 2, 3].map((i) => `${database}_par${i}_${process.pid}`);
const password = decodeURIComponent(new URL(appUrl).password) || process.env.APP_DB_PASSWORD;

afterAll(async () => {
  const admin = new pg.Client({ connectionString: withDatabaseName(ownerUrl, 'postgres') });
  await admin.connect();
  for (const n of names) await admin.query(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`);
  await admin.end();
});

describe('[Q14] parallel worktree migrations', () => {
  it('[Q14] concurrent full migrations of separate databases all succeed', async () => {
    const urls = names.map((n) => withDatabaseName(ownerUrl, n));
    for (const u of urls) await ensureDatabase(u);
    const results = await Promise.all(
      urls.map((u) => runMigrations({ connectionString: u, appDbPassword: password })),
    );
    for (const r of results) expect(r.applied.length).toBeGreaterThan(0);
  });
});
