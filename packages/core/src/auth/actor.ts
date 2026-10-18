// The authenticated caller, built from the session on every request (docs/01-architecture.md §5).
// T-101 builds it from `auth_resolve_session()`; T-102/T-013 add the permission catalogue and
// `assertPermission` (core/auth/permissions.ts). Never trust a workspaceId from the client.
export type BaseLevel = 'owner' | 'admin' | 'user';

export interface Actor {
  userId: string;
  workspaceId: string;
  sessionId: string;
  baseLevel: BaseLevel;
  /** Effective permissions (level ∪ roles, overrides applied). Owner implicitly has all. */
  permissions: ReadonlySet<string>;
  locale: 'en' | 'ur';
}

/** Owner always has everything (02 §1 "Effective permissions"). */
export function hasPermission(actor: Actor, key: string): boolean {
  return actor.baseLevel === 'owner' || actor.permissions.has(key);
}
