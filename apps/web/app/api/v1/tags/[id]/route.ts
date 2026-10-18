// PATCH/DELETE /api/v1/tags/:id. Delete cascades the join rows (no dangling references).
import { idParams, tagUpdateInput } from '@relay/contracts/api/crm';
import { tagsService } from '@relay/core/services/crm-config';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  permission: 'crm.tags.manage',
  params: idParams,
  body: tagUpdateInput,
  handler: ({ actor, params, body }) => tagsService.rename(actor, params.id, body),
});

export const DELETE = route({
  auth: 'session',
  permission: 'crm.tags.manage',
  params: idParams,
  handler: ({ actor, params }) => tagsService.remove(actor, params.id),
});
