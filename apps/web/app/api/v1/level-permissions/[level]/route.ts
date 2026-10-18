// PUT /api/v1/level-permissions/:level (roles.manage; F1.3): replace a base level's default grants.
import { levelParams, updateLevelPermissionsBody } from '@relay/contracts/api/team-admin';
import { rolesService } from '@relay/core/services/roles';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const PUT = route({
  auth: 'session',
  permission: 'roles.manage',
  params: levelParams,
  body: updateLevelPermissionsBody,
  handler: ({ actor, params, body }) => rolesService.updateLevelPermissions(actor, params.level, body),
});
