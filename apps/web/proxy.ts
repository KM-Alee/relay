// Next 16 Proxy (formerly middleware): locale negotiation/rewrites only (next-intl).
// Auth is NOT enforced here: pages check the session server-side and every API re-checks (F1.5).
// It also forwards the requested path as `x-relay-path` so server-side gating can redirect to
// `/login?next=<path>` (rubric 8: an alert deep link works after login). Client values are overwritten.
import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from './lib/i18n/routing';

const intl = createMiddleware(routing);

export default function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-relay-path', req.nextUrl.pathname + req.nextUrl.search);
  return intl(new NextRequest(req, { headers }));
}

export const config = {
  // Skip API routes, the public form (/f/*, no locale), Next internals and files with an extension.
  matcher: ['/((?!api|f/|_next|_vercel|.*\\..*).*)'],
};
