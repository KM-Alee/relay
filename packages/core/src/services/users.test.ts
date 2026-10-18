import { meResponse } from '@relay/contracts/api/users';
import { buildMe } from '@relay/contracts/fixtures/users';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor';
import { flagsOf, toMeResponse, type MeProfile } from './users';

const base: Actor = {
  userId: '0192f3a0-0000-7000-8000-000000000201',
  workspaceId: '0192f3a0-0000-7000-8000-000000000001',
  sessionId: 's1',
  baseLevel: 'user',
  permissions: new Set(['leads.create', 'crm.contact.view']),
  locale: 'ur',
};

const fx = buildMe();
const profile: MeProfile = {
  user: {
    name: fx.user.name,
    email: fx.user.email,
    timezone: fx.user.timezone,
    availability: fx.user.availability,
  },
  workspace: fx.workspace,
  settings: { ff_idle_retrigger: true, invite_ttl_hours: 72, ff_bad: 'yes' },
};

describe('usersService.toMeResponse', () => {
  it('[F1.3] returns the actor with its effective permissions, matching the contract', () => {
    const out = meResponse.parse(toMeResponse(base, profile));
    expect(out.permissions).toEqual(['crm.contact.view', 'leads.create']);
    expect(out.user).toMatchObject({ baseLevel: 'user', locale: 'ur', name: fx.user.name });
  });

  it('[F1.3] owner gets the full catalogue', () => {
    const out = toMeResponse({ ...base, baseLevel: 'owner', permissions: new Set() }, profile);
    expect(out.permissions).toContain('audit.view');
  });

  it('[F1.1] flags are only boolean ff_* workspace settings', () => {
    expect(flagsOf(profile.settings)).toEqual({ ff_idle_retrigger: true });
  });
});
