// GET /api/v1/users (users.manage): workspace users, keyset-paginated.
import { usersListQuery } from '@relay/contracts/api/users';
import { usersService } from '@relay/core/services/users';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'users.manage',
  query: usersListQuery,
  handler: ({ actor, query }) => usersService.list(actor, query),
});
