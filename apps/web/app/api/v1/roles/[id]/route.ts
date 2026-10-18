// PATCH/DELETE /api/v1/roles/:id (roles.manage; F1.7). PATCH needs the current `version` (409 STALE_VERSION).
import { updateRoleBody } from '@relay/contracts/api/team-admin';
import { idParams } from '@relay/contracts/api/users';
import { rolesService } from '@relay/core/services/roles';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PATCH = route({
  auth: 'session',
  permission: 'roles.manage',
  params: idParams,
  body: updateRoleBody,
  handler: ({ actor, params, body }) => rolesService.updateRole(actor, params.id, body),
});

export const DELETE = route({
  auth: 'session',
  permission: 'roles.manage',
  params: idParams,
  status: 204,
  handler: ({ actor, params }) => rolesService.deleteRole(actor, params.id),
});
