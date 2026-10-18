// Issues the readable `csrf` cookie used by the double-submit check (core/auth/csrf.ts).
import { createCsrfToken, CSRF_COOKIE, isValidCsrfToken } from '@relay/core/auth/csrf';

export function csrfCookieHeader(token: string, secure: boolean): string {
  // Readable by JS on purpose (double-submit); SameSite=Lax; 30 days (re-issued when invalid).
  return `${CSRF_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`;
}

/** Append a fresh csrf cookie to `res` when the request has no valid one. */
export function ensureCsrfCookie(
  res: Response,
  current: string | undefined,
  secret: string,
  secure: boolean,
): void {
  if (isValidCsrfToken(secret, current)) return;
  res.headers.append('set-cookie', csrfCookieHeader(createCsrfToken(secret), secure));
}
