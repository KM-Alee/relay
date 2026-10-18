// Vitest globalSetup for the `integration` project: create the test DB (if missing) and migrate it.
import { ensureDatabase, runMigrations } from '../src/migrate';
import { testDbUrls } from './db-urls';

export default async function setup(): Promise<void> {
  const { ownerUrl, appUrl, database } = testDbUrls();
  try {
    await ensureDatabase(ownerUrl);
    await runMigrations({
      connectionString: ownerUrl,
      // app_user's password must match the one in TEST_DATABASE_URL.
      appDbPassword: decodeURIComponent(new URL(appUrl).password) || process.env.APP_DB_PASSWORD,
    });
  } catch (err) {
    throw new Error(
      `Integration test DB "${database}" is not ready: ${(err as Error).message}\n` +
        'Is Postgres running? `pnpm db:up` (docker compose).',
      { cause: err },
    );
  }
}
