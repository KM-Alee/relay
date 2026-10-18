// POST /api/v1/auth/signup (F1.1): new workspace + Owner in one transaction, then signed in.
import { signupBody } from '@relay/contracts/api/auth';
import { authService } from '@relay/core/services/auth';
import { route } from '@/lib/http/route';
import { withSessionCookie } from '@/lib/http/session';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'public',
  body: signupBody,
  rateLimit: { name: 'signup', limit: 10, windowSeconds: 3600, by: 'ip' },
  status: 201,
  handler: async ({ body, req, ip }) => {
    const r = await authService.signup(body, { ip, userAgent: req.headers.get('user-agent') });
    return withSessionCookie(Response.json(r.me, { status: 201 }), r.session.token);
  },
});
