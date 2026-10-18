// Roles & permissions matrix (T-104; F1.2, F1.3, F1.7). Readable with users.manage; editable with roles.manage.
import { can } from '@relay/core/auth/permissions';
import { requirePermission } from '@/lib/http/page-auth';
import { RolesMatrix } from './roles-matrix';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await requirePermission('users.manage');
  return <RolesMatrix canEdit={can(actor, 'roles.manage')} />;
}
