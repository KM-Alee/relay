// Payments page (T-143; I2.1, I2.5-I2.7). Gate: nav.ts (perm payments.request); the API re-checks.
// Layout: Lane D3 (T-228). The AppShell renders <main>; the page renders header + body only.
import { getTranslations } from 'next-intl/server';
import { PaymentsView } from '@/components/payments/payments-view';
import { PageHeader } from '@/components/relay/page-header';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('payments'); // T-102: server-side gate (permission from nav.ts)
  const t = await getTranslations('payments');
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <PaymentsView />
    </>
  );
}
