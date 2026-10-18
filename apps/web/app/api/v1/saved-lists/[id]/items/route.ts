// GET /api/v1/saved-lists/:id/items: live evaluation with the viewer’s scope + masking.
import { idParams, savedListItemsQuery } from '@relay/contracts/api/crm';
import { listsService } from '@relay/core/services/lists';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  params: idParams,
  query: savedListItemsQuery,
  handler: ({ actor, params, query }) => listsService.items(actor, params.id, query),
});
