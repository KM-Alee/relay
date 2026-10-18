// /me: profile, language/theme, availability, sessions, Slack link (Lane D ProfileView). Signed-in users only.
import { ProfileView } from '@/components/relay/profile-view';
import { requireActor } from '@/lib/http/page-auth';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireActor();
  return <ProfileView />;
}
