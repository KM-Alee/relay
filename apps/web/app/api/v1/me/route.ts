// GET /api/v1/me: the worked example of the endpoint pattern (13 §4). 401 without a valid session.
import { usersService } from '@relay/core/services/users';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session', handler: ({ actor }) => usersService.me(actor) });
