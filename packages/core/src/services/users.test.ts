import { meResponse } from '@relay/contracts/api/users';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor';
import { usersService } from './users';

const base: Actor = {
  userId: '0192f3a0-0000-7000-8000-000000000201',
  workspaceId: '0192f3a0-0000-7000-8000-000000000001',
  sessionId: 's1',
  baseLevel: 'user',
  permissions: new Set(['leads.create', 'crm.contact.view']),
  locale: 'ur',
};

describe('usersService.me', () => {
  it('[F1.3] returns the actor with its effective permissions, matching the contract', () => {
    const out = meResponse.parse(usersService.me(base));
    expect(out.permissions).toEqual(['crm.contact.view', 'leads.create']);
    expect(out.user).toMatchObject({ baseLevel: 'user', locale: 'ur' });
  });

  it('[F1.3] owner gets the full catalogue', () => {
    const out = usersService.me({ ...base, baseLevel: 'owner', permissions: new Set() });
    expect(out.permissions).toContain('audit.view');
  });
});
