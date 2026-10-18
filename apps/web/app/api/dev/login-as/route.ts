// /api/dev/login-as: GET seed users · POST { userId } → real session for that seed user.
// 404 unless dev tools are on (NODE_ENV=development AND DEMO_MODE, 13 §5). POST is CSRF-protected.
import { devLoginAsBody } from '@relay/contracts/api/auth';
import { devLoginService } from '@relay/core/services/dev-login';
import { assertDevTools } from '@/lib/dev/guard';
import { route } from '@/lib/http/route';
import { withSessionCookie } from '@/lib/http/session';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'public',
  handler: async () => {
    assertDevTools();
    return { users: await devLoginService.listSeedUsers() };
  },
});

export const POST = route({
  auth: 'public',
  body: devLoginAsBody,
  handler: async ({ body, req, ip }) => {
    assertDevTools();
    const r = await devLoginService.loginAs(body.userId, { ip, userAgent: req.headers.get('user-agent') });
    return withSessionCookie(Response.json(r.me), r.session.token);
  },
});
