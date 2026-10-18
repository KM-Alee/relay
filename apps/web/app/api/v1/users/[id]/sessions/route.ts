// DELETE /api/v1/users/:id/sessions (Owner only; F1.8): end every session of a user.
import { idParams } from '@relay/contracts/api/users';
import { usersService } from '@relay/core/services/users';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const DELETE = route({
  auth: 'session',
  permission: 'users.manage',
  params: idParams,
  handler: ({ actor, params }) => usersService.endUserSessions(actor, params.id),
});
