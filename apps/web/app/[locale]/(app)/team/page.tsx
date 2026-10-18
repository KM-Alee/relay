// Team (T-103/T-104/T-105; docs/design/screens.md §8): members + availability + open load, invites, deactivate.
// Gate: nav.ts (users.manage). The APIs re-check every permission server-side.
import { can } from '@relay/core/auth/permissions';
import { requirePage } from '@/lib/http/page-auth';
import { TeamView } from './team-view';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await requirePage('team');
  return (
    <TeamView
      selfId={actor.userId}
      isOwner={actor.baseLevel === 'owner'}
      canInvite={can(actor, 'users.invite')}
      canManageRoles={can(actor, 'roles.manage')}
    />
  );
}
