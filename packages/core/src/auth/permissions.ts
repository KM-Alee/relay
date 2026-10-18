// Permission catalogue + enforcement (docs/06-security.md §2, F1.3, F1.5, F1.7).
// Never check role names or base levels in feature code: always assertPermission(actor, key) / can().
// Keys live in @relay/contracts/permissions (browser-safe); defaults below are the seeded grants
// (T-101 writes them to `level_permissions`; T-102 resolves effective permissions per request).
// Shared file (13 §2): additive edits only.
import { PERMISSION_KEYS, type PermissionKey } from '@relay/contracts/permissions';
import { forbidden } from '../errors';
import type { Actor, BaseLevel } from './actor';

export {
  PERMISSION_KEYS,
  isPermissionKey,
  permissionKeySchema,
  type PermissionKey,
} from '@relay/contracts/permissions';

const ALL: readonly PermissionKey[] = PERMISSION_KEYS;

/** Default grants per base level (06 §2 table). Owner implicitly holds everything. */
export const LEVEL_DEFAULTS: Readonly<Record<BaseLevel, readonly PermissionKey[]>> = {
  owner: ALL,
  // Admin: everything except audit.view, roles.manage, demo.judge_console (06 §2).
  admin: ALL.filter((k) => k !== 'audit.view' && k !== 'roles.manage' && k !== 'demo.judge_console'),
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

/** Seeded "Manager" custom role (F1.7): grants added on top of the user's base level. */
export const MANAGER_ROLE: { readonly key: 'manager'; readonly permissions: readonly PermissionKey[] } = {
  key: 'manager',
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

/** Boolean check, for shaping output. Owner always has everything. */
export function can(actor: Actor, key: PermissionKey): boolean {
  return actor.baseLevel === 'owner' || actor.permissions.has(key);
}

/** Throws AppError FORBIDDEN (403) when the actor lacks `key`. */
export function assertPermission(actor: Actor, key: PermissionKey): void {
  if (!can(actor, key)) throw forbidden({ permission: key });
}
