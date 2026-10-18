// PATCH /api/v1/web-forms/:id (routing.manage): title, slug, team, active. Lane A.
import { updateWebFormInput, webFormIdParams } from '@relay/contracts/api/automations';
import { policiesService } from '@relay/core/services/policies';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  permission: 'routing.manage',
  params: webFormIdParams,
  body: updateWebFormInput,
  handler: ({ actor, params, body }) => policiesService.updateWebForm(actor, params.id, body),
});
