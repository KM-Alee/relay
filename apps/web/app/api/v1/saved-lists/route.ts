// GET/POST /api/v1/saved-lists (F2.6).
import { savedListInput } from '@relay/contracts/api/crm';
import { listsService } from '@relay/core/services/lists';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  handler: ({ actor }) => listsService.list(actor),
});

export const POST = route({
  auth: 'session',
  body: savedListInput,
  status: 201,
  handler: ({ actor, body }) => listsService.create(actor, body),
});
