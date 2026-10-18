// POST /api/v1/users/:id/deactivate (users.manage; F1.8): never a hard delete; sessions end immediately.
import { deactivateUserBody } from '@relay/contracts/api/team-admin';
import { idParams } from '@relay/contracts/api/users';
import { usersService } from '@relay/core/services/users';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'users.manage',
  params: idParams,
  body: deactivateUserBody,
  handler: ({ actor, params, body }) => usersService.deactivate(actor, params.id, body),
});
