// POST /api/v1/invites/accept (public; F1.2): single-use token -> new user in that workspace, signed in.
import { acceptInviteBody } from '@relay/contracts/api/team-admin';
import { invitesService } from '@relay/core/services/invites';
import { route } from '@/lib/http/route';
import { withSessionCookie } from '@/lib/http/session';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'public',
  body: acceptInviteBody,
  rateLimit: { name: 'invite.accept', limit: 10, windowSeconds: 600, by: 'ip' },
  status: 201,
  handler: async ({ body, req, ip }) => {
    const r = await invitesService.accept(body, { ip, userAgent: req.headers.get('user-agent') });
    return withSessionCookie(Response.json(r.me, { status: 201 }), r.session.token);
  },
});
