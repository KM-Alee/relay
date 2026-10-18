// POST /api/v1/invites/preview (public): which workspace/level a link joins, without consuming it.
// The token is in the body, not the URL, so it stays out of access logs.
import { inviteTokenBody } from '@relay/contracts/api/team-admin';
import { invitesService } from '@relay/core/services/invites';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'public',
  body: inviteTokenBody,
  rateLimit: { name: 'invite.preview', limit: 30, windowSeconds: 600, by: 'ip' },
  handler: ({ body }) => invitesService.preview(body.token),
});
