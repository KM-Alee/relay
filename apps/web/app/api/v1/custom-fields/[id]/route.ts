// PATCH/DELETE /api/v1/custom-fields/:id.
import { idParams, customFieldUpdateInput } from '@relay/contracts/api/crm';
import { customFieldsService } from '@relay/core/services/crm-config';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  permission: 'crm.config.manage',
  params: idParams,
  body: customFieldUpdateInput,
  handler: ({ actor, params, body }) => customFieldsService.update(actor, params.id, body),
});

export const DELETE = route({
  auth: 'session',
  permission: 'crm.config.manage',
  params: idParams,
  handler: ({ actor, params }) => customFieldsService.remove(actor, params.id),
});
