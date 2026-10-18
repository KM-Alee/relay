// DB-backed sessions (docs/06-security.md §1, ADR-0004, F1.1, F1.8, Q1). Owner: Lane B (T-101).
//
// - Token: 32 random bytes, base64url, in cookie `sid` (`__Host-sid` when cookies are Secure, i.e.
//   production). The DB stores only sha256(token bytes) in sessions.token_hash.
// - Lifetime: sliding 7 days idle (last_seen_at, bumped at most every 5 min), 30 days absolute.
// - Validation: auth_resolve_session() (SECURITY DEFINER) returns only live sessions of active users.
// - Rotation: new token on login; on a privilege change the service calls `requireRotation(tx, …)` and
//   the user's next API request swaps the token (old row revoked, absolute expiry kept).
// - Effective permissions are loaded on every request (no cross-request cache, 06 §2).
import { createHash, randomBytes } from 'node:crypto';
import { withSystemTx, withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import { uuidv7 } from '../ids';
import * as repo from '../repos/identity';
import type { Actor } from './actor';
import { loadEffectivePermissions } from './effective-permissions';

export const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 3600;
export const SESSION_IDLE_SECONDS = 7 * 24 * 3600;

/** `__Host-` requires Secure + Path=/ + no Domain, so it is only used when cookies are Secure. */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-sid' : 'sid';
}

export function sessionCookieHeader(
  token: string,
  secure: boolean,
  maxAgeSeconds = SESSION_ABSOLUTE_SECONDS,
) {
  return (
    `${sessionCookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}` +
    (secure ? '; Secure' : '')
  );
}

export function clearSessionCookieHeader(secure: boolean): string {
  return `${sessionCookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** sha256 of the 32 raw token bytes, or null for anything that isn't a well-formed token. */
export function hashSessionToken(token: string | undefined | null): Buffer | null {
  if (!token || !TOKEN_RE.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== 32) return null;
  return createHash('sha256').update(raw).digest();
}

export function newSessionToken(): { token: string; hash: Buffer } {
  const raw = randomBytes(32);
  return { token: raw.toString('base64url'), hash: createHash('sha256').update(raw).digest() };
}

export interface ClientInfo {
  ip?: string | null;
  userAgent?: string | null;
}

const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);
/** inet column: accept only something that looks like an IP (x-forwarded-for may be 'unknown'). */
const ipOrNull = (ip: string | null | undefined) =>
  ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) && ip !== 'unknown' ? ip : null;

export interface CreatedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

/** Insert a new session row inside the caller's workspace transaction. */
export async function createSession(
  tx: Tx,
  s: { workspaceId: string; userId: string; expiresAt?: Date } & ClientInfo,
): Promise<CreatedSession> {
  const { token, hash } = newSessionToken();
  const sessionId = uuidv7();
  const { expiresAt } = await repo.insertSession(tx, {
    id: sessionId,
    workspaceId: s.workspaceId,
    userId: s.userId,
    tokenHash: hash,
    ip: ipOrNull(s.ip),
    userAgent: clip(s.userAgent, 512),
    expiresAt: s.expiresAt,
  });
  return { sessionId, token, expiresAt };
}

export interface ResolvedSession {
  actor: Actor;
  /** Set when this request rotated the token: the caller must send it as the new cookie. */
  rotated?: CreatedSession;
}

export interface ResolveOptions extends ClientInfo, TxOptions {
  /** Only API route handlers can set cookies; Server Components pass false. */
  allowRotate?: boolean;
}

/** Cookie token → Actor (with effective permissions), or null when missing/invalid/expired/revoked. */
export async function resolveSession(
  token: string | undefined | null,
  opts: ResolveOptions = {},
): Promise<ResolvedSession | null> {
  const hash = hashSessionToken(token);
  if (!hash) return null;
  const txo: TxOptions = { db: opts.db };
  const row = await withSystemTx((tx) => repo.resolveSession(tx, hash), txo);
  if (!row) return null;
  return withWorkspaceTx(
    row.workspaceId,
    async (tx) => {
      const permissions = await loadEffectivePermissions(tx, row.workspaceId, row.userId, row.baseLevel);
      let sessionId = row.sessionId;
      let rotated: CreatedSession | undefined;
      if (row.rotateRequired && opts.allowRotate) {
        // Conditional revoke: of two concurrent requests only one rotates.
        if (await repo.revokeSession(tx, row.workspaceId, row.sessionId)) {
          rotated = await createSession(tx, {
            workspaceId: row.workspaceId,
            userId: row.userId,
            expiresAt: row.expiresAt,
            ip: opts.ip,
            userAgent: opts.userAgent,
          });
          sessionId = rotated.sessionId;
        }
      } else {
        await repo.touchSession(tx, row.workspaceId, row.sessionId);
      }
      const actor: Actor = {
        userId: row.userId,
        workspaceId: row.workspaceId,
        sessionId,
        baseLevel: row.baseLevel,
        permissions,
        locale: row.locale,
      };
      return { actor, rotated };
    },
    txo,
  );
}

/**
 * Privilege change hook (06 §1 "Rotation"): call in the SAME transaction as a base-level/role/override
 * change. The user's live sessions get a new token on their next API request.
 */
export async function requireRotation(tx: Tx, workspaceId: string, userId: string): Promise<number> {
  return repo.markRotateRequired(tx, workspaceId, userId);
}

/** Deactivation / "end all sessions" (F1.8): revoke every live session of a user in the caller's tx. */
export async function revokeAllSessions(tx: Tx, workspaceId: string, userId: string): Promise<number> {
  return repo.revokeAllUserSessions(tx, workspaceId, userId);
}
