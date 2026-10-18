// GET /api/v1/me/sessions (F1.8): own live sessions, current one flagged.
import { usersService } from '@relay/core/services/users';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session', handler: ({ actor }) => usersService.mySessions(actor) });
