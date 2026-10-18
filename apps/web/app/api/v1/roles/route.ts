// GET/POST /api/v1/roles (F1.7). GET: users.manage or roles.manage (checked in the service); POST: roles.manage.
import { createRoleBody } from '@relay/contracts/api/team-admin';
import { rolesService } from '@relay/core/services/roles';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session', handler: ({ actor }) => rolesService.listRoles(actor) });

export const POST = route({
  auth: 'session',
  permission: 'roles.manage',
  body: createRoleBody,
  status: 201,
  handler: ({ actor, body }) => rolesService.createRole(actor, body),
});
