// GET/POST /api/v1/invites (users.invite; F1.2): list, create (returns the copyable link once).
import { createInviteBody } from '@relay/contracts/api/team-admin';
import { invitesService } from '@relay/core/services/invites';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'users.invite',
  handler: ({ actor }) => invitesService.list(actor),
});

export const POST = route({
  auth: 'session',
  permission: 'users.invite',
  body: createInviteBody,
  status: 201,
  rateLimit: { name: 'invites.create', limit: 30, windowSeconds: 3600, by: 'user' },
  handler: ({ actor, body }) => invitesService.create(actor, body),
});
