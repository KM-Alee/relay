// Appointments page (T-144; I3.1-I3.7). Gate: nav.ts (perm appointments.manage); APIs re-check.
// Layout: Lane D3 (T-228). The AppShell renders <main>; the page renders header + body only.
import { getTranslations } from 'next-intl/server';
import { AppointmentsView } from '@/components/calendar/appointments-view';
import { PageHeader } from '@/components/relay/page-header';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string; book?: string; contactId?: string; contactName?: string }>;
}) {
  await requirePage('appointments'); // T-102: server-side gate (permission from nav.ts)
  const t = await getTranslations('appointments');
  const { calendar, book, contactId, contactName } = await searchParams;
  const prefill =
    book && contactId && /^[0-9a-f-]{36}$/i.test(contactId)
      ? { contactId, contactName: (contactName ?? '').slice(0, 200) }
      : null;
  const banner = ['connected', 'denied', 'error', 'unavailable'].includes(calendar ?? '') ? calendar! : null;
  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <AppointmentsView banner={banner} prefill={prefill} />
    </>
  );
}
