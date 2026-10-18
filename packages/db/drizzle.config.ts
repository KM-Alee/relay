import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` writes DRAFT SQL into packages/db/drizzle/ (gitignored). Review it, then copy the
// statements into a hand-written, timestamped migration in packages/db/migrations/ and add the RLS
// call (sql/templates/tenant-table.sql). The runner (src/migrate.ts) applies only migrations/.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
});
