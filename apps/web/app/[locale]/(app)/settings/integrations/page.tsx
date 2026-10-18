// Integrations page (T-140; I5.1). Replaces the W0 stub. Gate: nav.ts (perm integrations.view); the API re-checks.
import { getTranslations } from 'next-intl/server';
import { IntegrationsView } from './integrations-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('integrations'); // T-102: server-side gate
  const t = await getTranslations('integrations');
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-semibold">{t('title')}</h1>
      <IntegrationsView />
    </main>
  );
}
