// GET/PUT /api/v1/users/:id/permission-overrides (F1.3). GET: users.manage or roles.manage; PUT: roles.manage.
import { setOverridesBody } from '@relay/contracts/api/team-admin';
import { idParams } from '@relay/contracts/api/users';
import { rolesService } from '@relay/core/services/roles';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  params: idParams,
  handler: ({ actor, params }) => rolesService.getOverrides(actor, params.id),
});

export const PUT = route({
  auth: 'session',
  permission: 'roles.manage',
  params: idParams,
  body: setOverridesBody,
  handler: ({ actor, params, body }) => rolesService.setOverrides(actor, params.id, body),
});
