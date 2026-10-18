// PATCH/DELETE /api/v1/saved-lists/:id.
import { idParams, savedListUpdateInput } from '@relay/contracts/api/crm';
import { listsService } from '@relay/core/services/lists';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  params: idParams,
  body: savedListUpdateInput,
  handler: ({ actor, params, body }) => listsService.update(actor, params.id, body),
});

export const DELETE = route({
  auth: 'session',
  params: idParams,
  handler: ({ actor, params }) => listsService.remove(actor, params.id),
});
