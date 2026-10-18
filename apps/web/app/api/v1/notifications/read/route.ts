// POST /api/v1/notifications/read {ids} | {all:true}: mark own notifications read (F3.4). Lane A.
import { markReadInput } from '@relay/contracts/api/notifications';
import { notificationsService } from '@relay/core/services/notifications';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  body: markReadInput,
  handler: ({ actor, body }) => notificationsService.markRead(actor, body),
});
