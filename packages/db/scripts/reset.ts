// pnpm db:reset → DROP + CREATE + migrate DATABASE_URL_UNPOOLED's database. LOCAL ONLY (refuses other hosts).
import { requireEnv } from './env';
import { recreateLocalDatabase, runMigrations } from '../src/migrate';

const url = requireEnv(
  process.argv.includes('--test') ? 'TEST_DATABASE_URL_UNPOOLED' : 'DATABASE_URL_UNPOOLED',
);
try {
  await recreateLocalDatabase(url);
  const res = await runMigrations({ connectionString: url, appDbPassword: process.env.APP_DB_PASSWORD });
  console.log(`reset ${new URL(url).pathname.slice(1)}: ${res.applied.length} migrations applied`);
  console.log('next: pnpm db:seed (login-able seed workspaces, docs/12-demo-and-ops.md)');
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
