import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Local env: apps/web/.env.local (written by you or by scripts/wt.sh per worktree). CI sets env directly.
// Values already in process.env win (loadEnvFile never overwrites).
for (const file of ['apps/web/.env.local', '.env.test.local']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const reporters = process.env.CI ? ['default', ['json', { outputFile: 'reports/vitest.json' }]] : ['default'];

export default defineConfig({
  // apps/web's `@/…` path alias (tsconfig paths) for web unit tests.
  resolve: { alias: [{ find: /^@\//, replacement: `${path.resolve(import.meta.dirname, 'apps/web')}/` }] },
  test: {
    // Feeds the traceability reporter (docs/08-testing.md §2) when CI=1.
    reporters: reporters as never,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts', 'apps/web/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/.next/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['packages/*/test/integration/**/*.test.ts'],
          // Creates the test DB named in TEST_DATABASE_URL if missing and runs migrations.
          globalSetup: ['packages/db/test/global-setup.ts'],
          // Runtime code under test connects as app_user to the test DB.
          setupFiles: ['packages/db/test/setup-env.ts'],
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
