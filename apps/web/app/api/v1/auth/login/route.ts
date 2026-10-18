// POST /api/v1/auth/login (F1.1, Q1): rate-limited per IP + per email inside the service (06 §1).
import { loginBody } from '@relay/contracts/api/auth';
import { authService } from '@relay/core/services/auth';
import { route } from '@/lib/http/route';
import { readSessionToken, withSessionCookie } from '@/lib/http/session';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'public',
  body: loginBody,
  handler: async ({ body, req, ip }) => {
    const r = await authService.login(body, {
      ip,
      userAgent: req.headers.get('user-agent'),
      currentToken: readSessionToken(req),
    });
    return withSessionCookie(Response.json(r.me), r.session.token);
  },
});
