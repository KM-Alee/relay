// CSRF defence for /api/v1 mutations (docs/06-security.md §4, F1.5):
//   (a) Origin (fallback Referer) must match the request host or PUBLIC_BASE_URL, and
//   (b) signed double-submit: readable cookie `csrf` == header `x-csrf-token`, and the token's
//       HMAC (SESSION_SECRET) is valid, so a cookie planted by a sibling subdomain is useless.
// Exempt by path prefix: webhooks (incl. /api/webhooks/slack/**), /api/internal/*, /api/public/*.
// They authenticate with signatures / bearer secrets / per-render tokens instead.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE = 'csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_EXEMPT_PREFIXES = ['/api/webhooks/', '/api/internal/', '/api/public/'] as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isUnsafeMethod = (method: string) => !SAFE_METHODS.has(method.toUpperCase());

export function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p));
}

const sign = (secret: string, nonce: string) =>
  createHmac('sha256', secret).update(`csrf:${nonce}`).digest('base64url');

/** New token: `<nonce>.<hmac(nonce)>`, both base64url. Set it as the readable `csrf` cookie. */
export function createCsrfToken(secret: string): string {
  const nonce = randomBytes(24).toString('base64url');
  return `${nonce}.${sign(secret, nonce)}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function isValidCsrfToken(secret: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  return safeEqual(token.slice(dot + 1), sign(secret, token.slice(0, dot)));
}

export interface CsrfInput {
  method: string;
  pathname: string;
  /** `Origin` header (preferred) and `Referer` (fallback). */
  origin: string | null;
  referer: string | null;
  /** Host the request was addressed to (x-forwarded-host ?? host). */
  host: string | null;
  cookieToken: string | undefined;
  headerToken: string | null;
  /** Extra trusted origins, e.g. new URL(PUBLIC_BASE_URL).origin. */
  trustedOrigins: readonly string[];
  secret: string;
}

export type CsrfFailure =
  'origin_missing' | 'origin_mismatch' | 'token_missing' | 'token_mismatch' | 'token_invalid';
export type CsrfResult = { ok: true } | { ok: false; reason: CsrfFailure };

function originOf(value: string | null): string | null {
  if (!value || value === 'null') return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function verifyCsrf(input: CsrfInput): CsrfResult {
  if (!isUnsafeMethod(input.method) || isCsrfExempt(input.pathname)) return { ok: true };

  // (a) Origin / Referer
  const origin = originOf(input.origin) ?? originOf(input.referer);
  if (!origin) return { ok: false, reason: 'origin_missing' };
  const sameHost = input.host !== null && new URL(origin).host === input.host;
  if (!sameHost && !input.trustedOrigins.includes(origin)) return { ok: false, reason: 'origin_mismatch' };

  // (b) signed double-submit
  if (!input.cookieToken || !input.headerToken) return { ok: false, reason: 'token_missing' };
  if (!safeEqual(input.cookieToken, input.headerToken)) return { ok: false, reason: 'token_mismatch' };
  if (!isValidCsrfToken(input.secret, input.cookieToken)) return { ok: false, reason: 'token_invalid' };
  return { ok: true };
}
