// GET /api/v1/users/:id (users.manage). Other workspaces' ids → 404.
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
