// [Q8] [Q7] [Q16] [Q17] Kitchen sink + Overview shell: axe (serious/critical) in en/ur x light/dark,
// no horizontal scroll at 375px, lang/dir correct. Needs DEMO_MODE=1 NEXT_PUBLIC_API_FIXTURES=1 (dev server).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const LOCALES = [
  { id: 'en', prefix: '', dir: 'ltr' },
  { id: 'ur', prefix: '/ur', dir: 'rtl' },
] as const;
const THEMES = ['light', 'dark'] as const;
const PAGES = [
  { id: 'kitchen-sink', path: '/dev/kitchen-sink' },
  { id: 'overview', path: '/' },
] as const;

for (const loc of LOCALES) {
  for (const theme of THEMES) {
    for (const pg of PAGES) {
      test(`[Q8][Q16][Q17] ${pg.id} passes axe in ${loc.id} ${theme}`, async ({ page }) => {
        await page.addInitScript((th) => localStorage.setItem('relay-theme', th), theme);
        await page.goto(`${loc.prefix}${pg.path}`);
        await page.waitForLoadState('networkidle');
        const html = page.locator('html');
        await expect(html).toHaveAttribute('dir', loc.dir);
        await expect(html).toHaveAttribute('lang', loc.id);
        await expect(html).toHaveAttribute('data-theme', theme);
        const results = await new AxeBuilder({ page }).analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      });

      test(`[Q7] ${pg.id} has no horizontal scroll at 375px in ${loc.id} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 800 });
        await page.addInitScript((th) => localStorage.setItem('relay-theme', th), theme);
        await page.goto(`${loc.prefix}${pg.path}`);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          'document.documentElement.scrollWidth - document.documentElement.clientWidth',
        );
        expect(overflow as number).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `reports/screenshots/${pg.id}-${loc.id}-${theme}-375.png`,
          fullPage: true,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.screenshot({
          path: `reports/screenshots/${pg.id}-${loc.id}-${theme}-1440.png`,
          fullPage: pg.id === 'kitchen-sink',
        });
      });
    }
  }
}
