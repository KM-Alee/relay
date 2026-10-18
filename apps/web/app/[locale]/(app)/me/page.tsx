// Profile (`/me`). Owner: Lane B (T-105 adds the sessions card; language/theme/Slack-link sections are
// added by their lanes as separate cards). Signed-in users only.
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/relay';
import { requireActor } from '@/lib/http/page-auth';
import { SessionsCard } from './sessions-card';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireActor();
  const t = await getTranslations('team');
  return (
    <>
      <PageHeader title={t('me.title')} description={t('me.subtitle')} />
      <div className="flex max-w-3xl flex-col gap-6">
        <SessionsCard />
      </div>
    </>
  );
}
