'use client';
// Secondary Overview cards (screens.md section 2): team availability, open pipeline by stage, upcoming
// appointments, escalations (24 h) and the Revenue at Risk / Rescued hero stats. Lane D.
import type { OverviewResponse } from '@relay/contracts/api/dashboard';
import { CalendarClock, ChevronRight, Siren, TriangleAlert, Users, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/relay/empty-state';
import { Ltr } from '@/components/relay/ltr';
import { MaskedValue } from '@/components/relay/masked-value';
import { AVAILABILITY_META, Avatar } from '@/components/relay/owner-chip';
import { SkeletonGroup } from '@/components/relay/skeleton-group';
import { useFormat } from '@/lib/format/use-format';
import { Link } from '@/lib/i18n/navigation';
import { toUiAvailability } from './helpers';
import { Ticker } from './ticker';

type Data = OverviewResponse | undefined;

function CardStates({
  state,
  onRetry,
  children,
}: {
  state: 'ready' | 'loading' | 'error';
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('common');
  if (state === 'loading')
    return (
      <SkeletonGroup className="mt-4 space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-5/6" />
        <Skeleton className="h-8 w-2/3" />
      </SkeletonGroup>
    );
  if (state === 'error')
    return (
      <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-body text-danger">
        <TriangleAlert aria-hidden className="size-4" />
        <span>{t('states.error')}</span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('actions.retry')}
        </Button>
      </div>
    );
  return <div className="mt-4">{children}</div>;
}

// ── Team availability ────────────────────────────────────────────────────
export function TeamAvailabilityCard({
  data,
  state,
  onRetry,
}: {
  data: Data;
  state: 'ready' | 'loading' | 'error';
  onRetry: () => void;
}) {
  const t = useTranslations('overview.team');
  const c = useTranslations('common');
  const f = useFormat();
  const members = data?.team.members ?? [];
  const counts = (['available', 'busy', 'on_leave', 'offline'] as const).map((a) => ({
    a,
    n: members.filter((m) => m.availability === a).length,
  }));
  return (
    <Card className="h-full">
      <CardHeader
        icon={<Users />}
        title={t('title')}
        description={t('scope')}
        actions={
          <Link href="/team" className="text-meta text-brand-text underline-offset-4 hover:underline">
            {t('total', { count: members.length })}
          </Link>
        }
      />
      <CardStates state={state} onRetry={onRetry}>
        <ul className="mb-4 flex flex-wrap gap-2" aria-label={c('availability.label')}>
          {counts.map(({ a, n }) => {
            const ui = toUiAvailability(a);
            const meta = AVAILABILITY_META[ui];
            return (
              <li
                key={a}
                className="inline-flex items-center gap-1.5 rounded-chip border border-line bg-surface-muted px-2.5 py-1 text-meta"
              >
                <span aria-hidden className={cn('size-2 rounded-chip', meta.dot)} />
                <Icon icon={meta.icon} className={cn('size-3.5', meta.text)} />
                <Ltr className="tabular font-semibold">{f.number(n)}</Ltr>
                <span className="text-fg-2">{c(`availability.${ui}`)}</span>
              </li>
            );
          })}
        </ul>
        {members.length === 0 ? (
          <p className="text-body text-fg-2">{t('empty')}</p>
        ) : (
          <ul className="space-y-1">
            {members.map((m) => {
              const ui = toUiAvailability(m.availability);
              const meta = AVAILABILITY_META[ui];
              return (
                <li key={m.userId} className="flex min-h-11 items-center gap-3">
                  <span className="relative">
                    <Avatar name={m.name} />
                    <span
                      aria-hidden
                      className={cn(
                        'absolute -bottom-0.5 -end-0.5 size-2.5 rounded-chip border-2 border-surface',
                        meta.dot,
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-fg">{m.name}</span>
                    <span className={cn('flex items-center gap-1 text-meta', meta.text)}>
                      <Icon icon={meta.icon} className="size-3.5" />
                      {c(`availability.${ui}`)}
                    </span>
                  </span>
                  <span className="text-meta text-fg-2">{t('openLeads', { count: m.openLeads })}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardStates>
    </Card>
  );
}

// ── Open pipeline by stage ───────────────────────────────────────────────
export function StageBars({
  stages,
  currency,
}: {
  stages: OverviewResponse['pipeline']['stages'];
  currency: string;
}) {
  const t = useTranslations('overview.pipeline');
  const f = useFormat();
  const anyMasked = stages.some((s) => s.value.masked);
  const max = Math.max(1, ...stages.map((s) => (anyMasked ? s.count : (s.value.value ?? 0))));
  return (
    <ul className="space-y-3">
      {stages.map((s) => {
        const size = anyMasked ? s.count : (s.value.value ?? 0);
        return (
          <li key={s.stageId}>
            <Link
              href={`/pipeline?stage=${encodeURIComponent(s.stageId)}`}
              className="group block rounded-control p-1 hover:bg-surface-muted"
            >
              <div className="flex items-baseline justify-between gap-3 text-body">
                <span className="min-w-0 truncate font-medium text-fg">{s.name}</span>
                <span className="shrink-0 text-meta text-fg-2">
                  {t('count', { count: s.count })} ·{' '}
                  {s.value.masked ? (
                    <MaskedValue className="text-meta" />
                  ) : (
                    <Ltr className="tabular font-semibold text-fg">
                      {f.money(s.value.value ?? 0, currency, { compact: true })}
                    </Ltr>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-chip bg-brand-faint" aria-hidden>
                <div
                  className="h-full rounded-chip bg-chart-1 transition-[width] duration-(--dur-slow)"
                  style={{ width: `${Math.max(3, (size / max) * 100)}%` }}
                />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function PipelineCard({
  data,
  state,
  onRetry,
}: {
  data: Data;
  state: 'ready' | 'loading' | 'error';
  onRetry: () => void;
}) {
  const t = useTranslations('overview.pipeline');
  const f = useFormat();
  const stages = data?.pipeline.stages ?? [];
  return (
    <Card className="h-full">
      <CardHeader icon={<Workflow />} title={t('title')} description={t('scope')} />
      <CardStates state={state} onRetry={onRetry}>
        {stages.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title={t('empty')}
            className="py-6"
            action={
              <Button asChild variant="secondary">
                <Link href="/pipeline">{t('emptyAction')}</Link>
              </Button>
            }
          />
        ) : (
          <>
            <StageBars stages={stages} currency={data?.currency ?? 'PKR'} />
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-body">
              <span className="text-fg-2">{t('total')}</span>
              {data?.pipeline.total.masked ? (
                <MaskedValue />
              ) : (
                <Ltr className="tabular font-semibold text-fg">
                  {f.money(data?.pipeline.total.value ?? 0, data?.currency)}
                </Ltr>
              )}
            </div>
            {data?.pipeline.total.masked ? (
              <p className="mt-2 text-meta text-fg-muted">{t('maskedNote')}</p>
            ) : null}
          </>
        )}
      </CardStates>
    </Card>
  );
}

// ── Upcoming appointments ────────────────────────────────────────────────
export function AppointmentsCard({
  data,
  state,
  onRetry,
}: {
  data: Data;
  state: 'ready' | 'loading' | 'error';
  onRetry: () => void;
}) {
  const t = useTranslations('overview.appointments');
  const f = useFormat();
  const items = data?.appointments.items ?? [];
  const extra = (data?.appointments.total ?? 0) - items.length;
  return (
    <Card className="h-full">
      <CardHeader
        icon={<CalendarClock />}
        title={t('title')}
        description={t('scope')}
        actions={
          <Link href="/appointments" className="text-meta text-brand-text underline-offset-4 hover:underline">
            {t('viewAll')}
          </Link>
        }
      />
      <CardStates state={state} onRetry={onRetry}>
        {items.length === 0 ? (
          <p className="text-body text-fg-2">{t('empty')}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((a) => (
              <li key={a.id} className="flex items-center gap-3">
                <span className="flex min-w-16 flex-col items-center rounded-control bg-brand-faint px-2 py-1.5 text-center">
                  <span className="text-meta text-fg-2">
                    {f.date(a.startsAt, { day: 'numeric', month: 'short' })}
                  </span>
                  <Ltr className="tabular text-body font-semibold text-fg">{f.time(a.startsAt)}</Ltr>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-body font-medium text-fg">{a.title}</span>
                  <span className="block truncate text-meta text-fg-2">
                    {t('with', { contact: a.contactName, owner: a.ownerName })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {extra > 0 ? <p className="mt-3 text-meta text-fg-muted">{t('more', { count: extra })}</p> : null}
      </CardStates>
    </Card>
  );
}

// ── Escalations (24 h) ───────────────────────────────────────────────────
export function EscalationsCard({
  data,
  state,
  onRetry,
}: {
  data: Data;
  state: 'ready' | 'loading' | 'error';
  onRetry: () => void;
}) {
  const t = useTranslations('overview.escalations');
  const f = useFormat();
  const n = data?.escalations24h.count ?? 0;
  return (
    <Card className="h-full">
      <CardHeader icon={<Siren />} title={t('title')} description={t('scope')} />
      <CardStates state={state} onRetry={onRetry}>
        <Link
          href="/recovery?reason=escalated"
          className="group flex items-end justify-between gap-3 rounded-control hover:bg-surface-muted"
        >
          <div>
            <span className="text-kpi text-fg">
              <Ticker value={n} format={(v) => f.number(v)} />
            </span>
            <p className="mt-1 text-body text-fg-2">{n === 0 ? t('none') : t('count', { count: n })}</p>
          </div>
          <Icon icon={ChevronRight} flipInRtl className="mb-2 text-fg-muted" />
        </Link>
        {data && data.escalations24h.idleRetriggers > 0 ? (
          <p className="mt-3 border-t border-line pt-3 text-meta text-fg-2">
            {t('idle', { count: f.number(data.escalations24h.idleRetriggers) })}
          </p>
        ) : null}
      </CardStates>
    </Card>
  );
}

// ── Revenue at risk / rescued (P1 hero overlay, F5.7, F5.8) ──────────────
export function RevenueHero({ data, className }: { data: Data; className?: string }) {
  const t = useTranslations('overview.risk');
  const f = useFormat();
  if (!data || (data.revenueAtRisk === null && data.revenueRescued === null)) return null;
  const tile = (
    label: string,
    help: string,
    fig: NonNullable<Data>['revenueAtRisk'],
    tone: 'warning' | 'success',
    live?: boolean,
  ) =>
    fig === null ? null : (
      <div className="rounded-card border border-line bg-surface/85 p-4 shadow-card backdrop-blur-md">
        <p
          className={cn(
            'flex items-center gap-1.5 text-meta font-medium',
            tone === 'warning' ? 'text-warning' : 'text-success',
          )}
        >
          <Icon icon={tone === 'warning' ? TriangleAlert : Siren} />
          {label}
          {live ? (
            <span className="ms-auto inline-flex items-center gap-1 rounded-chip bg-warning-surface px-2 py-0.5 text-[11px] font-semibold">
              <span aria-hidden className="size-1.5 rounded-chip bg-warning anim-pulse" />
              {t('badge')}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-[26px] font-semibold leading-tight text-fg">
          {fig.masked ? (
            <MaskedValue />
          ) : (
            <Ltr>
              <Ticker value={fig.value ?? 0} format={(n) => f.money(n, data.currency, { compact: true })} />
            </Ltr>
          )}
        </p>
        <p className="mt-0.5 text-meta text-fg-2">{help}</p>
      </div>
    );
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {tile(t('atRisk'), t('atRiskHelp'), data.revenueAtRisk, 'warning', true)}
      {tile(t('rescued'), t('rescuedHelp'), data.revenueRescued, 'success')}
    </div>
  );
}
