import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { assertPermission, can, LEVEL_DEFAULTS, MANAGER_ROLE, PERMISSION_KEYS } from './permissions';

const actor = (baseLevel: Actor['baseLevel'], perms: Actor['permissions'] = new Set()): Actor => ({
  userId: 'u',
  workspaceId: 'w',
  sessionId: 's',
  baseLevel,
  permissions: perms,
  locale: 'en',
});

describe('permission catalogue', () => {
  it('[F1.3] keys are unique dot.notation', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const k of PERMISSION_KEYS) expect(k).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });

  it('[F1.3] level defaults follow 06 §2', () => {
    expect(LEVEL_DEFAULTS.owner).toHaveLength(PERMISSION_KEYS.length);
    expect(LEVEL_DEFAULTS.admin).not.toContain('audit.view');
    expect(LEVEL_DEFAULTS.admin).not.toContain('roles.manage');
    expect(LEVEL_DEFAULTS.admin).toContain('users.manage');
    expect(LEVEL_DEFAULTS.user).not.toContain('crm.opportunity.value.view');
    expect(LEVEL_DEFAULTS.user).not.toContain('crm.contact.delete');
    expect(LEVEL_DEFAULTS.user).toContain('leads.create');
  });

  it('[F1.7] seeded Manager role adds view-all, reassign, recovery, availability', () => {
    for (const k of ['leads.view_all', 'leads.reassign', 'leads.recovery.view', 'team.availability.view'])
      expect(MANAGER_ROLE.permissions).toContain(k);
  });

  it('[F1.5] assertPermission throws FORBIDDEN without the key; owner always passes', () => {
    expect(() => assertPermission(actor('user'), 'audit.view')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', httpStatus: 403 }),
    );
    expect(() => assertPermission(actor('user', new Set(['audit.view'])), 'audit.view')).not.toThrow();
    expect(can(actor('owner'), 'demo.judge_console')).toBe(true);
  });
});
