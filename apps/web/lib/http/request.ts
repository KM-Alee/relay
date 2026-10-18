// Small request helpers shared by route() and future middleware-free handlers.

/** Parse one cookie from the Cookie header (no dependency on next/headers, so it is unit-testable). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Host the client addressed (Vercel sets x-forwarded-host). */
export function requestHost(req: Request): string | null {
  return req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
}

/** Client IP for rate-limit keys. On Vercel the first x-forwarded-for entry is the client. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip') || 'unknown';
}
