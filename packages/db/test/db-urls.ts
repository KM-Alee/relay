// Test DB resolution (docs/13-parallel-development.md §6: per-worktree databases).
// The DB NAME comes from TEST_DATABASE_URL (app_user); owner credentials/host from
// TEST_DATABASE_URL_UNPOOLED. Defaults match docker-compose + .env.example for a fresh clone.
import { databaseNameOf, isLocalDatabaseUrl, withDatabaseName } from '../src/migrate';

const DEFAULT_APP = 'postgres://app_user:app_user_dev@localhost:5432/relay_test';
const DEFAULT_OWNER = 'postgres://postgres:postgres@localhost:5432/relay_test';

export function testDbUrls(): { appUrl: string; ownerUrl: string; database: string } {
  const appUrl = process.env.TEST_DATABASE_URL || DEFAULT_APP;
  const database = databaseNameOf(appUrl);
  const ownerUrl = withDatabaseName(process.env.TEST_DATABASE_URL_UNPOOLED || DEFAULT_OWNER, database);
  if (!isLocalDatabaseUrl(ownerUrl) && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
    throw new Error(
      'Integration tests refuse a non-local DB unless ALLOW_REMOTE_TEST_DB=1 (e.g. Neon CI branch).',
    );
  }
  return { appUrl, ownerUrl, database };
}
