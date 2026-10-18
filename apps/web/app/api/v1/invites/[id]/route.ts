// DELETE /api/v1/invites/:id (users.invite; F1.2): revoke a pending invite.
import { idParams } from '@relay/contracts/api/users';
import { invitesService } from '@relay/core/services/invites';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const DELETE = route({
  auth: 'session',
  permission: 'users.invite',
  params: idParams,
  status: 204,
  handler: ({ actor, params }) => invitesService.revoke(actor, params.id),
});
