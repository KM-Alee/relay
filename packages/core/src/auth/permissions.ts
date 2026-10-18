// Permission catalogue + enforcement (docs/06-security.md §2, F1.3, F1.5, F1.7).
// Never check role names or base levels in feature code: always assertPermission(actor, key) / can().
// Keys live in @relay/contracts/permissions (browser-safe); the seeded grants (level defaults, Manager
// role) live in @relay/contracts/permission-defaults so db seeds share them. Signup writes them to
// `level_permissions`/`roles`; ./effective-permissions.ts resolves them per request (T-102).
// Shared file (13 §2): additive edits only.
import type { PermissionKey } from '@relay/contracts/permissions';
import { forbidden } from '../errors';
import type { Actor } from './actor';

export {
  PERMISSION_KEYS,
  isPermissionKey,
  permissionKeySchema,
  type PermissionKey,
} from '@relay/contracts/permissions';
export { LEVEL_DEFAULTS, MANAGER_ROLE, OWNER_ONLY_GRANTS } from '@relay/contracts/permission-defaults';

/** Boolean check, for shaping output. Owner always has everything. */
export function can(actor: Actor, key: PermissionKey): boolean {
  return actor.baseLevel === 'owner' || actor.permissions.has(key);
}

/** Throws AppError FORBIDDEN (403) when the actor lacks `key`. */
export function assertPermission(actor: Actor, key: PermissionKey): void {
  if (!can(actor, key)) throw forbidden({ permission: key });
}
