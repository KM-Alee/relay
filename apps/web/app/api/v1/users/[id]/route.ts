// GET/PATCH /api/v1/users/:id (users.manage). Other workspaces' ids → 404. PATCH: level/roles, versioned.
import { updateUserBody } from '@relay/contracts/api/team-admin';
import { idParams } from '@relay/contracts/api/users';
import { usersService } from '@relay/core/services/users';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'users.manage',
  params: idParams,
  handler: ({ actor, params }) => usersService.get(actor, params.id),
});

export const PATCH = route({
  auth: 'session',
  permission: 'users.manage',
  params: idParams,
  body: updateUserBody,
  handler: ({ actor, params, body }) => usersService.update(actor, params.id, body),
});
