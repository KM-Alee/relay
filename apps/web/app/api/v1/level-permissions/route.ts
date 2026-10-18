// GET /api/v1/level-permissions (users.manage or roles.manage): admin/user default grants.
import { rolesService } from '@relay/core/services/roles';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  handler: ({ actor }) => rolesService.listLevelPermissions(actor),
});
