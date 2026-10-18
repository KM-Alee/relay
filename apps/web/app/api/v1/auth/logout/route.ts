// POST /api/v1/auth/logout (F1.1): revoke the current session and clear the cookie. Always 204, so an
// already-expired session can still clear its cookie. CSRF-protected like every mutation.
import { authService } from '@relay/core/services/auth';
import { route } from '@/lib/http/route';
import { readSessionToken, withClearedSessionCookie } from '@/lib/http/session';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'public',
  handler: async ({ req }) => {
    await authService.logout(readSessionToken(req));
    return withClearedSessionCookie(new Response(null, { status: 204 }));
  },
});
