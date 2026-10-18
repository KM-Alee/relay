import { defineConfig, devices } from '@playwright/test';

// E2E skeleton (docs/08-testing.md). Browsers: `pnpm exec playwright install chromium` (not needed for
// API-only `request` tests). Against a deployed preview: E2E_BASE_URL=https://… pnpm test:e2e
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['json', { outputFile: 'reports/playwright.json' }]] : [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @relay/web dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
