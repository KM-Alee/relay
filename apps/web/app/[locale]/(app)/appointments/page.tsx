// Appointments page (T-144; I3.1-I3.7). Replaces the W0 stub. Gate: nav.ts (perm appointments.manage); APIs re-check.
import { getTranslations } from 'next-intl/server';
import { AppointmentsView } from '@/components/calendar/appointments-view';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  await requirePage('appointments'); // T-102: server-side gate (permission from nav.ts)
  const t = await getTranslations('appointments');
  const { calendar } = await searchParams;
  const banner = ['connected', 'denied', 'error', 'unavailable'].includes(calendar ?? '') ? calendar! : null;
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">{t('title')}</h1>
      <p className="mb-6 opacity-70">{t('subtitle')}</p>
      <AppointmentsView banner={banner} />
    </main>
  );
}
