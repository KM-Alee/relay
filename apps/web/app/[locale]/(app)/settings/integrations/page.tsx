// Integrations page (T-140; I5.1). Gate: nav.ts (perm integrations.view); the API re-checks.
// Layout: Lane D3 (T-228). The AppShell renders <main>; the page renders header + body only.
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/relay/page-header';
import { IntegrationsView } from './integrations-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('integrations'); // T-102: server-side gate
  const t = await getTranslations('integrations');
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <IntegrationsView />
    </>
  );
}
