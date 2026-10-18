// GET /api/v1/notifications: own latest notifications + unread count (F3.4). Lane A.
import { notificationsService } from '@relay/core/services/notifications';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session', handler: ({ actor }) => notificationsService.list(actor) });
