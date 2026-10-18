'use client';
// Primary chart (screens.md section 2): collected revenue per day (line/area) + payments count (bars, own axis).
// Without the value permission the SERVER sends null amounts; we switch to "leads per day + escalations".
// Charts live in a dir="ltr" island (ChartCard) with localized labels. Recharts reads tokens via CSS variables.
import type { OverviewResponse } from '@relay/contracts/api/dashboard';
import { Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChartCard } from '@/components/relay/chart-card';
import { useFormat } from '@/lib/format/use-format';
import { Link } from '@/lib/i18n/navigation';
import { Wipe } from './reveal';
import { Ticker } from './ticker';

const PERIODS = [7, 30, 90] as const;

export function PaymentsChart({
  data,
  days,
  onDaysChange,
  state,
  onRetry,
}: {
  data: OverviewResponse | undefined;
  days: number;
  onDaysChange: (d: number) => void;
  state: 'ready' | 'loading' | 'error';
  onRetry: () => void;
}) {
  const t = useTranslations('overview.payments');
  const f = useFormat();
  const masked = data ? data.payments.total.masked : false;

  const rows = useMemo(() => {
    if (!data) return [];
    return masked
      ? data.leadsPerDay.map((d) => ({ date: d.date, a: d.leads, b: d.escalations }))
      : data.payments.series.map((d) => ({
          date: d.date,
          a: (d.collectedMinor ?? 0) / 100,
          b: d.payments,
        }));
  }, [data, masked]);

  const dayLabel = (iso: string) => f.date(`${iso}T12:00:00Z`, { day: 'numeric', month: 'short' });
  const empty = rows.length === 0 || rows.every((r) => r.a === 0 && r.b === 0);
  const cardState = state !== 'ready' ? state : empty ? 'empty' : 'ready';

  const periodSelect = (
    <Select value={String(days)} onValueChange={(v) => onDaysChange(Number(v))}>
      <SelectTrigger aria-label={t('period')} className="min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIODS.map((p) => (
          <SelectItem key={p} value={String(p)}>
            {t(`days${p}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const total = data?.payments.total;
  const best = rows.reduce((m, r) => (r.a > m.a ? r : m), rows[0] ?? { date: '', a: 0, b: 0 });
  const totalCount = data?.payments.series.reduce((s, d) => s + d.payments, 0) ?? 0;
  const fmtCompact = (n: number) => f.compact(n);

  return (
    <ChartCard
      className="h-full"
      icon={<Wallet />}
      title={masked ? t('titleLeads') : t('title')}
      scope={t('scope', {
        scope: data?.scope === 'mine' ? t('scopeMine') : t('scopeCompany'),
        days: f.number(days),
      })}
      unit={masked ? undefined : data?.currency}
      actions={periodSelect}
      state={cardState}
      emptyTitle={masked ? t('emptyLeads') : t('emptyTitle')}
      onRetry={onRetry}
      legend={
        masked
          ? [
              { label: t('leads'), swatch: 'bg-chart-primary' },
              { label: t('escalations'), swatch: 'bg-warning' },
            ]
          : [
              { label: t('collected'), swatch: 'bg-chart-primary' },
              { label: t('count'), swatch: 'bg-chart-secondary' },
            ]
      }
      summary={
        data ? (
          <div className="space-y-2">
            <p>
              {masked
                ? t('summaryLeads', {
                    days: f.number(days),
                    leads: rows.reduce((s, r) => s + r.a, 0),
                    escalations: rows.reduce((s, r) => s + r.b, 0),
                  })
                : t('summary', {
                    total: f.money(total?.value ?? 0, data.currency),
                    days: f.number(days),
                    count: totalCount,
                    bestDay: best.date ? dayLabel(best.date) : '',
                    best: f.money(Math.round(best.a * 100), data.currency),
                  })}
            </p>
            <table className="w-full text-start text-meta">
              <thead>
                <tr>
                  <th className="py-1 text-start font-medium">{t('tableDate')}</th>
                  <th className="py-1 text-start font-medium">{masked ? t('leads') : t('tableAmount')}</th>
                  <th className="py-1 text-start font-medium">
                    {masked ? t('escalations') : t('tableCount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(-10).map((r) => (
                  <tr key={r.date}>
                    <td className="py-0.5">{dayLabel(r.date)}</td>
                    <td className="py-0.5 tabular">
                      {masked ? f.number(r.a) : f.money(Math.round(r.a * 100), data.currency)}
                    </td>
                    <td className="py-0.5 tabular">{f.number(r.b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null
      }
    >
      <div
        className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1"
        dir={f.locale === 'ur' ? 'rtl' : 'ltr'}
      >
        {masked ? (
          <p className="text-meta text-fg-2">{t('maskedNote')}</p>
        ) : (
          <>
            <span className="text-kpi text-fg">
              <Ticker
                value={total?.value ?? 0}
                format={(n) => f.money(n, data?.currency, { compact: true })}
              />
            </span>
            <span className="text-meta text-fg-2">{t('totalLabel', { days: f.number(days) })}</span>
            <Link href="/payments" className="text-meta text-brand-text underline-offset-4 hover:underline">
              {t('viewAll')}
            </Link>
          </>
        )}
      </div>
      <Wipe className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="pay-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--chart-primary)" stopOpacity={0.18} />
                <stop offset="1" stopColor="var(--chart-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={32}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            />
            <YAxis
              yAxisId="a"
              tickFormatter={(v: number) => fmtCompact(v)}
              tickLine={false}
              axisLine={false}
              width={44}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            />
            <YAxis yAxisId="b" orientation="right" hide domain={[0, (m: number) => Math.max(m * 3, 4)]} />
            <Tooltip
              cursor={{ stroke: 'var(--border-strong)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as { a: number; b: number };
                return (
                  <div className="rounded-control border border-line bg-surface px-3 py-2 text-meta text-fg shadow-pop">
                    <p className="font-medium">{dayLabel(String(label))}</p>
                    <p className="tabular">
                      {masked ? t('leads') : t('collected')}:{' '}
                      {masked ? f.number(p.a) : f.money(Math.round(p.a * 100), data?.currency)}
                    </p>
                    <p className="tabular">
                      {masked ? t('escalations') : t('count')}: {f.number(p.b)}
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              yAxisId={masked ? 'a' : 'b'}
              dataKey={masked ? 'a' : 'b'}
              fill={masked ? 'var(--chart-primary)' : 'var(--chart-secondary)'}
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
            {masked ? (
              <Line
                yAxisId="a"
                dataKey="b"
                type="monotone"
                stroke="var(--warning)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ) : (
              <>
                <Area
                  yAxisId="a"
                  dataKey="a"
                  type="monotone"
                  stroke="none"
                  fill="url(#pay-fill)"
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="a"
                  dataKey="a"
                  type="monotone"
                  stroke="var(--chart-primary)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: 'var(--brand)', stroke: 'var(--surface)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </Wipe>
    </ChartCard>
  );
}
