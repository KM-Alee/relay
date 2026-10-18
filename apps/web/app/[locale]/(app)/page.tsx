// Overview (T-150, T-201). Owner: Lane D. Server part: greeting + date eyebrow; the figures are client queries
// against /api/v1/dashboard/* (role-aware and masked on the server).
import { getLocale } from 'next-intl/server';
import { OverviewView } from '@/components/overview/overview-view';
import { DEFAULT_TIME_ZONE, formatDate } from '@/lib/format';
import type { Locale } from '@/lib/i18n/routing';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const locale = (await getLocale()) as Locale;
  const { tab } = await searchParams;
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: DEFAULT_TIME_ZONE }).format(
      now,
    ),
  );
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const eyebrow = formatDate(locale, now, DEFAULT_TIME_ZONE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return <OverviewView eyebrow={eyebrow} part={part} initialTab={tab === 'radar' ? 'radar' : 'summary'} />;
}
