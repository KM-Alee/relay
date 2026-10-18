// Effective-permission resolver (docs/02-data-model.md §1, docs/06-security.md §2, F1.3, F1.7). T-102.
//
//   effective = level_permissions[base_level] (or the code default when the workspace has no row)
//             ∪ permissions of every assigned role
//             then user overrides: grant adds, deny removes (deny wins over everything)
//   Owner: always the full catalogue (overrides cannot lock the Owner out).
//
// Loaded from the DB on EVERY request (no cross-request cache), so permission changes apply on the next
// request (06 §2). Unknown keys stored in the DB (e.g. a renamed permission) are ignored.
import type { Tx } from '@relay/db';
import * as repo from '../repos/identity';
import type { BaseLevel } from './actor';
import { isPermissionKey, LEVEL_DEFAULTS, PERMISSION_KEYS, type PermissionKey } from './permissions';

export interface PermissionSources {
  baseLevel: BaseLevel;
  /** The workspace's level row, or null to use LEVEL_DEFAULTS. */
  levelPermissions: readonly string[] | null;
  rolePermissions: readonly (readonly string[])[];
  overrides: readonly { permission: string; effect: 'grant' | 'deny' }[];
}

/** Pure resolver (unit-tested exhaustively). */
export function computeEffectivePermissions(src: PermissionSources): Set<PermissionKey> {
  if (src.baseLevel === 'owner') return new Set(PERMISSION_KEYS);
  const out = new Set<PermissionKey>();
  const add = (k: string) => {
    if (isPermissionKey(k)) out.add(k);
  };
  (src.levelPermissions ?? LEVEL_DEFAULTS[src.baseLevel]).forEach(add);
  for (const perms of src.rolePermissions) perms.forEach(add);
  for (const o of src.overrides) if (o.effect === 'grant') add(o.permission);
  for (const o of src.overrides)
    if (o.effect === 'deny' && isPermissionKey(o.permission)) out.delete(o.permission);
  return out;
}

/** Load the sources for one user inside a workspace transaction and resolve them. */
export async function loadEffectivePermissions(
  tx: Tx,
  workspaceId: string,
  userId: string,
  baseLevel: BaseLevel,
): Promise<Set<PermissionKey>> {
  if (baseLevel === 'owner') return new Set(PERMISSION_KEYS);
  const src = await repo.permissionSources(tx, workspaceId, userId, baseLevel);
  return computeEffectivePermissions({
    baseLevel,
    levelPermissions: src.level,
    rolePermissions: src.roles,
    overrides: src.overrides,
  });
}
