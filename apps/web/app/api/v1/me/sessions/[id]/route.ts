// DELETE /api/v1/me/sessions/:id (F1.8): end one of your own sessions. Not yours → 404. 204.
import { idParams } from '@relay/contracts/api/users';
import { usersService } from '@relay/core/services/users';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const DELETE = route({
  auth: 'session',
  params: idParams,
  status: 204,
  handler: ({ actor, params }) => usersService.revokeMySession(actor, params.id),
});
