// Conversations inbox (T-146; I1.3-I1.11). Replaces the W0 stub. Gate: nav.ts; the APIs re-check everything.
import { getTranslations } from 'next-intl/server';
import { InboxView } from '@/components/inbox';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('inbox');
  const t = await getTranslations('inbox');
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold">{t('title')}</h1>
      <InboxView />
    </main>
  );
}
