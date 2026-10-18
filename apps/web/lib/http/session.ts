// Session → Actor resolution for API route handlers (T-101). route() depends only on `ResolveActor`.
//
// Reads the `sid` cookie (`__Host-sid` in production), resolves it through core/auth/sessions
// (auth_resolve_session SECURITY DEFINER → effective permissions per request) and returns the Actor, or
// null when missing/expired/revoked/deactivated (→ 401). When the session had to be rotated (privilege
// change), the new cookie is queued for this request and route() appends it via `applySessionCookies`.
// Server Components use lib/http/page-auth.ts instead (no cookie writes there).
import type { Actor } from '@relay/core/auth/actor';
import {
  clearSessionCookieHeader,
  resolveSession,
  sessionCookieHeader,
  sessionCookieName,
} from '@relay/core/auth/sessions';
import { clientIp, readCookie } from './request';

export type ResolveActor = (req: Request) => Promise<Actor | null>;

/** Secure cookies (and the `__Host-` prefix) in production only; dev runs on http://localhost. */
export const secureCookies = (): boolean => process.env.NODE_ENV === 'production';

export function readSessionToken(req: Request): string | undefined {
  return readCookie(req, sessionCookieName(secureCookies()));
}

const pendingCookies = new WeakMap<Request, string>();

export const resolveActor: ResolveActor = async (req) => {
  const token = readSessionToken(req);
  if (!token) return null;
  const resolved = await resolveSession(token, {
    allowRotate: true,
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });
  if (!resolved) return null;
  if (resolved.rotated) pendingCookies.set(req, sessionCookieHeader(resolved.rotated.token, secureCookies()));
  return resolved.actor;
};

/** Called by route() on every response: emits a cookie queued by a rotation during this request. */
export function applySessionCookies(req: Request, res: Response): void {
  const cookie = pendingCookies.get(req);
  if (
    cookie &&
    !res.headers.getSetCookie().some((c) => c.startsWith(`${sessionCookieName(secureCookies())}=`))
  )
    res.headers.append('set-cookie', cookie);
}

/** Response helpers for the auth routes (login/signup/logout/dev login-as). */
export function withSessionCookie(res: Response, token: string): Response {
  res.headers.append('set-cookie', sessionCookieHeader(token, secureCookies()));
  return res;
}

export function withClearedSessionCookie(res: Response): Response {
  res.headers.append('set-cookie', clearSessionCookieHeader(secureCookies()));
  return res;
}
