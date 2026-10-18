// Seeded permission grants (docs/06-security.md §2 table, F1.3, F1.7). Data only, so packages/db seeds,
// core (signup + the effective-permission resolver) and the roles UI share ONE definition.
// Re-exported by @relay/core/auth/permissions. Owner: Lane B.
import { PERMISSION_KEYS, type PermissionKey } from './permissions';

export type BaseLevelKey = 'owner' | 'admin' | 'user';

/** Default grants per base level. Owner implicitly holds everything (never stored/filtered). */
export const LEVEL_DEFAULTS: Readonly<Record<BaseLevelKey, readonly PermissionKey[]>> = {
  owner: PERMISSION_KEYS,
  // Admin: everything except audit.view, roles.manage, demo.judge_console (06 §2).
  admin: PERMISSION_KEYS.filter(
    (k) => k !== 'audit.view' && k !== 'roles.manage' && k !== 'demo.judge_console',
  ),
  user: [
    'crm.contact.view',
    'crm.contact.create',
    'crm.contact.edit',
    'crm.company.view',
    'crm.company.create',
    'crm.company.edit',
    'crm.opportunity.view',
    'crm.opportunity.create',
    'crm.opportunity.edit',
    'leads.create',
    'team.availability.view',
    'messaging.send',
    'payments.request',
    'appointments.manage',
    'ai.use',
  ],
};

/** Seeded "Manager" custom role (F1.7): grants added on top of the user's base level. Editable. */
export const MANAGER_ROLE: {
  readonly key: 'manager';
  readonly name: string;
  readonly permissions: readonly PermissionKey[];
} = {
  key: 'manager',
  name: 'Manager',
  permissions: [
    'crm.opportunity.value.view',
    'leads.view_all',
    'leads.reassign',
    'leads.recovery.view',
    'team.availability.view',
    'appointments.override',
    'dashboard.company',
  ],
};

/** Permissions an Admin may never grant (Owner-protection, 06 §2). Enforced in services/users. */
export const OWNER_ONLY_GRANTS: readonly PermissionKey[] = ['roles.manage', 'audit.view'];
