// Payments page (T-143; I2.1, I2.5-I2.7). Replaces the W0 stub. Gate: nav.ts (perm payments.request); the API re-checks.
import { getTranslations } from 'next-intl/server';
import { PaymentsView } from '@/components/payments/payments-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('payments'); // T-102: server-side gate (permission from nav.ts)
  const t = await getTranslations('payments');
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">{t('title')}</h1>
      <p className="mb-6 opacity-70">{t('subtitle')}</p>
      <PaymentsView />
    </main>
  );
}
