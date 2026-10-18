// Fixtures for the team-admin contracts (13 §4). Owner: Lane B.
import type { InviteSummary, RoleSummary } from '../api/team-admin';
import { buildMe, buildUserSummary, FIXTURE_OWNER_ID } from './users';

const ROLE_ID = '0192f3a0-0000-7000-8000-000000000a01';

export function buildInvite(overrides: Partial<InviteSummary> = {}): InviteSummary {
  return {
    id: '0192f3a0-0000-7000-8000-000000000901',
    baseLevel: 'user',
    roleId: null,
    roleName: null,
    status: 'pending',
    createdBy: FIXTURE_OWNER_ID,
    createdByName: 'Ayesha Khan',
    createdAt: '2026-10-18T09:00:00.000Z',
    expiresAt: '2026-10-21T09:00:00.000Z',
    usedByName: null,
    ...overrides,
  };
}

export function buildRole(overrides: Partial<RoleSummary> = {}): RoleSummary {
  return {
    id: ROLE_ID,
    key: 'manager',
    name: 'Manager',
    permissions: ['leads.view_all', 'leads.reassign', 'leads.recovery.view', 'team.availability.view'],
    memberCount: 1,
    version: 0,
    ...overrides,
  };
}

const overrides = () => ({ items: [], effective: ['crm.contact.view' as const] });

export const teamAdminFixtures = {
  invites: () => ({ items: [buildInvite()] }),
  createInvite: () => ({
    invite: buildInvite(),
    link: 'http://localhost:3000/en/invite/fixture-token-fixture-token-fixture',
  }),
  revokeInvite: () => undefined,
  previewInvite: () => ({
    workspaceName: 'Sunrise Solar',
    baseLevel: 'user' as const,
    roleName: null,
    expiresAt: '2026-10-21T09:00:00.000Z',
  }),
  acceptInvite: () => buildMe(),
  roles: () => ({ items: [buildRole()] }),
  createRole: () => buildRole({ key: null, name: 'Custom', permissions: [] }),
  updateRole: () => buildRole(),
  deleteRole: () => undefined,
  levelPermissions: () => ({
    items: [
      { baseLevel: 'admin' as const, permissions: ['crm.contact.view' as const], version: 0 },
      { baseLevel: 'user' as const, permissions: ['crm.contact.view' as const], version: 0 },
    ],
  }),
  updateLevelPermissions: () => ({
    baseLevel: 'user' as const,
    permissions: ['crm.contact.view' as const],
    version: 1,
  }),
  overrides,
  setOverrides: overrides,
  updateUser: () => buildUserSummary(),
  deactivateUser: () => buildUserSummary({ isActive: false }),
  endUserSessions: () => ({ revoked: 1 }),
};
