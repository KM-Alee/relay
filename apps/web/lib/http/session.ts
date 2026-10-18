// Session → Actor resolution: the extension point for T-101 (auth).
//
// T-101 replaces the body of `resolveActor`: read the `sid` cookie (`__Host-sid` in production),
// sha256 it, call `auth_resolve_session(token_hash)` inside withSystemTx, load effective
// permissions, and return the Actor (or null when missing/expired/revoked/deactivated → 401).
// Keep the signature: route() depends only on `ResolveActor`.
import type { Actor } from '@relay/core/auth/actor';

export type ResolveActor = (req: Request) => Promise<Actor | null>;

export const resolveActor: ResolveActor = async () => null; // no auth yet (T-101)
