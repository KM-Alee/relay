// Overview shell (T-012). Owner: Lane D. T-150 replaces the empty KPI tiles with real figures (F5.1).
import { Clock3, LifeBuoy, UserPlus } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { KpiTile } from '@/components/relay/kpi-tile';
import { PageHeader } from '@/components/relay/page-header';
import { DEFAULT_TIME_ZONE, formatDate } from '@/lib/format';
import type { Locale } from '@/lib/i18n/routing';

export default async function OverviewPage() {
  const t = await getTranslations('overview');
  const locale = (await getLocale()) as Locale;
  await getFormatter();
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
  const empty = t('kpi.emptyText');
  return (
    <>
      <PageHeader hero art eyebrow={eyebrow} title={t(`greeting.${part}`)} description={t('subtitle')} />
      <div className="grid gap-4 md:grid-cols-3">
        <KpiTile icon={<UserPlus />} label={t('kpi.newLeads')} state="empty" emptyText={empty} />
        <KpiTile icon={<Clock3 />} label={t('kpi.response')} state="empty" emptyText={empty} />
        <KpiTile icon={<LifeBuoy />} label={t('kpi.recovery')} state="empty" emptyText={empty} />
      </div>
    </>
  );
}
