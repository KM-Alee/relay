import { isPermissionKey } from '@relay/contracts/permissions';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './messages/en/common.json';
import { NAV, visibleNav } from './nav';

const appDir = path.resolve(import.meta.dirname, 'app/[locale]/(app)');

describe('nav.ts', () => {
  it('[F1.5] every permission key used in nav exists in the catalogue', () => {
    for (const item of NAV) if (item.perm !== null) expect(isPermissionKey(item.perm), item.id).toBe(true);
  });

  it('[F7.1] every label key exists in common.json', () => {
    const nav = (en as { nav: Record<string, string> }).nav;
    for (const item of NAV) expect(nav[item.labelKey.slice(4)], item.id).toBeTruthy();
  });

  it('[Q14] every destination has a page', () => {
    for (const item of NAV) {
      const page = path.join(appDir, item.href === '/' ? '' : item.href, 'page.tsx');
      expect(existsSync(page), page).toBe(true);
    }
  });

  it('[F1.5] screens.md §1 order: 6 primary + 7 more; hidden entries filtered by permission', () => {
    expect(NAV.filter((i) => i.group === 'primary').map((i) => i.id)).toEqual([
      'overview',
      'leads',
      'inbox',
      'pipeline',
      'recovery',
      'automations',
    ]);
    expect(NAV.filter((i) => i.group === 'more')).toHaveLength(7);
    const user = visibleNav(new Set(['crm.opportunity.view']));
    expect(user.map((i) => i.id)).not.toContain('recovery');
    expect(user.map((i) => i.id)).toContain('pipeline');
    expect(visibleNav(new Set(), { isOwner: true }).map((i) => i.id)).not.toContain('judge');
    expect(visibleNav(new Set(), { isOwner: true, demoMode: true }).map((i) => i.id)).toContain('judge');
  });
});
