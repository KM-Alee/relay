// Conversations inbox (T-146; I1.3-I1.11). Gate: nav.ts; the APIs re-check everything. Layout: Lane D3 (T-228).
// The AppShell already renders <main>; pages render a header + body only (one main landmark).
import { getTranslations } from 'next-intl/server';
import { InboxView } from '@/components/inbox';
import { PageHeader } from '@/components/relay/page-header';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('inbox');
  const t = await getTranslations('inbox');
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} className="pb-4 md:pb-5" />
      <InboxView />
    </>
  );
}
