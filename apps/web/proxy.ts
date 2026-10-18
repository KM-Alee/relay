// Next 16 Proxy (formerly middleware): locale negotiation/rewrites only (next-intl).
// Auth is NOT enforced here: pages check the session server-side and every API re-checks (F1.5).
import createMiddleware from 'next-intl/middleware';
import { routing } from './lib/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Skip API routes, the public form (/f/*, no locale), Next internals and files with an extension.
  matcher: ['/((?!api|f/|_next|_vercel|.*\\..*).*)'],
};
