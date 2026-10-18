// The authenticated caller, built from the session on every request (docs/01-architecture.md §5).
// T-101 builds it from `auth_resolve_session()`; T-102 loads effective permissions per request.
// Enforcement: core/auth/permissions.ts (`assertPermission`, `can`). Never trust a client workspaceId.
import type { PermissionKey } from '@relay/contracts/permissions';

export type BaseLevel = 'owner' | 'admin' | 'user';

export interface Actor {
  userId: string;
  workspaceId: string;
  sessionId: string;
  baseLevel: BaseLevel;
  /** Effective permissions (level ∪ roles, overrides applied). Owner implicitly has all. */
  permissions: ReadonlySet<PermissionKey>;
  locale: 'en' | 'ur';
}

/** Owner always has everything (02 §1 "Effective permissions"). Prefer `can()` from ./permissions. */
export function hasPermission(actor: Actor, key: PermissionKey): boolean {
  return actor.baseLevel === 'owner' || actor.permissions.has(key);
}
