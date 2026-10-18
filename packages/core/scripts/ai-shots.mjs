// Screenshots of the AI admin pages (T-208): en light 1440 and ur dark 375. Output dir = argv[2].
import { chromium } from '@playwright/test';

const base = process.env.BASE ?? 'http://localhost:3108';
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROME });

async function shots(locale, scheme, width, height, tag) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/login`);
  await page.getByLabel(/email/i).fill('owner@sunrise.test');
  await page
    .getByLabel(/password/i)
    .first()
    .fill('relay-dev-password');
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 });
  for (const p of ['ai', 'knowledge', 'templates']) {
    await page.goto(`${base}/${locale}/settings/${p}`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${tag}-${p}.png`, fullPage: true });
  }
  await ctx.close();
}
await shots('en', 'light', 1440, 900, 'en-light-1440');
await shots('ur', 'dark', 375, 800, 'ur-dark-375');
await browser.close();
