'use client';
// Integrations page body (I5.1, I5.6, I4.4). Data logic by Lane C; design by Lane D3 (T-228):
// ProviderStatus cards (components.md §2) with live status dots, last OK, breaker + failures surfaced at the
// point of action, stated limits (I5.6), webhook URLs, and the sync history table (integration events).
// Tokens only, logical properties only, all strings from next-intl (`integrations`).
import type {
  IntegrationCardDto,
  IntegrationEventDto,
  IntegrationProvider,
  IntegrationsListResponse,
} from '@relay/contracts/api/integrations';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bot,
  CalendarDays,
  Check,
  CircleAlert,
  Copy,
  CreditCard,
  Hash,
  History,
  KeyRound,
  MessageCircle,
  Pause,
  Phone,
  Play,
  PlugZap,
  RotateCw,
  ShieldCheck,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { DataTable, type Column } from '@/components/relay/data-table';
import { EmptyState } from '@/components/relay/empty-state';
import { FormField } from '@/components/relay/form-field';
import { RelayLottie } from '@/components/relay/lottie';
import { Ltr } from '@/components/relay/ltr';
import { Collapse } from '@/components/relay/motion/presence';
import { Stagger, StaggerItem } from '@/components/relay/motion/primitives';
import { SkeletonGroup } from '@/components/relay/skeleton-group';
import { StatusBadge, type StatusTone } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Input, fieldClass } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';

const PROVIDER_ICON: Record<IntegrationProvider, LucideIcon> = {
  meta_whatsapp: MessageCircle,
  twilio_whatsapp: Phone,
  stripe: CreditCard,
  google_calendar: CalendarDays,
  slack: Hash,
  openai: Bot,
};
const STATUS_TONE: Record<IntegrationCardDto['status'], StatusTone> = {
  connected: 'success',
  error: 'danger',
  needs_reconnect: 'warning',
  not_connected: 'neutral',
};
const EVENT_TONE: Record<IntegrationEventDto['status'], StatusTone> = {
  processed: 'success',
  received: 'info',
  processing: 'info',
  rejected: 'danger',
  failed: 'danger',
  ignored: 'neutral',
};

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function IntegrationsView() {
  const t = useTranslations('integrations');
  const fmt = useFormatter();
  const now = useNow();
  const [data, setData] = useState<IntegrationsListResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const [tick, setTick] = useState(0);
  const load = async () => setTick((n) => n + 1);
  useEffect(() => {
    let live = true;
    api.integrations.list().then(
      (d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [tick]);

  if (failed)
    return (
      <div
        role="alert"
        className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger-surface p-4 text-danger"
      >
        <CircleAlert aria-hidden className="size-5 shrink-0" />
        <span className="text-body">{t('loadFailed')}</span>
        <Button size="sm" variant="secondary" className="ms-auto" onClick={() => void load()}>
          <Icon icon={RotateCw} />
          {t('retry')}
        </Button>
      </div>
    );
  if (!data)
    return (
      <SkeletonGroup className="grid gap-(--card-gap) lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-64 w-full rounded-card" />
        ))}
      </SkeletonGroup>
    );

  const connected = data.cards.filter((c) => c.status === 'connected').length;
  const attention = data.cards.filter(
    (c) =>
      c.status === 'error' ||
      c.status === 'needs_reconnect' ||
      c.deadJobs > 0 ||
      c.connection?.health.state === 'open',
  ).length;
  const tickFresh = data.lastTickAt ? now - new Date(data.lastTickAt).getTime() < 5 * 60_000 : false;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone="success" icon={ShieldCheck} className="px-3 py-1">
          {t('summary.connected', { count: connected, total: data.cards.length })}
        </StatusBadge>
        {attention > 0 ? (
          <StatusBadge tone="warning" className="px-3 py-1">
            {t('summary.attention', { count: attention })}
          </StatusBadge>
        ) : null}
        <span className="ms-auto inline-flex items-center gap-2 rounded-chip border border-line bg-surface py-1 ps-1.5 pe-3 text-meta text-fg-2 shadow-card">
          {tickFresh ? (
            <RelayLottie name="live" className="size-6" />
          ) : (
            <span aria-hidden className="live-dot ms-2 me-1 text-neutral" />
          )}
          {t('lastTick', {
            when: data.lastTickAt ? fmt.relativeTime(new Date(data.lastTickAt), now) : t('never'),
          })}
        </span>
      </div>

      <Stagger className="grid grid-cols-1 gap-(--card-gap) lg:grid-cols-2">
        {data.cards.map((c) => (
          <StaggerItem key={c.provider} className="flex min-w-0 [&>section]:min-w-0 [&>section]:flex-1">
            <ProviderCard card={c} slack={data.slack} now={now} onChanged={load} />
          </StaggerItem>
        ))}
      </Stagger>

      <SyncHistory />
    </div>
  );
}

function ProviderCard({
  card,
  slack,
  now,
  onChanged,
}: {
  card: IntegrationCardDto;
  slack: IntegrationsListResponse['slack'];
  now: number;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('integrations');
  const fmt = useFormatter();
  const tr = useTranslations();
  const [editing, setEditing] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conn = card.connection;
  const breaker = conn?.health.state ?? 'closed';
  const Glyph = PROVIDER_ICON[card.provider];
  const isConnected = card.status === 'connected';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const secretsIn: Record<string, string> = {};
    const publicIn: Record<string, string> = {};
    for (const f of card.secretFields) {
      const v = String(form.get(f) ?? '').trim();
      if (v) secretsIn[f] = v;
    }
    for (const f of card.publicFields) {
      const v = String(form.get(f) ?? '').trim();
      if (v) publicIn[f] = v;
    }
    setBusy(true);
    try {
      await api.integrations.connect({
        params: { provider: card.provider },
        body: { secrets: secretsIn, publicConfig: publicIn },
      });
      setEditing(false);
      setError(null);
      toast.success(t('saved', { name: t(`providers.${card.provider}.name`) }));
      await onChanged();
    } catch (err) {
      setError(localizeError(err, tr));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    try {
      await api.integrations.disconnect({ params: { provider: card.provider } });
      await onChanged();
    } catch (err) {
      setError(localizeError(err, tr));
    }
  }

  async function breakerTo(state: 'open' | 'closed') {
    await api.integrations.forceBreaker({ params: { provider: card.provider }, body: { state } });
    await onChanged();
  }

  return (
    <section
      aria-labelledby={`int-${card.provider}`}
      className={cn(
        'flex flex-col rounded-card border bg-surface p-(--card-pad) shadow-card transition-shadow duration-(--dur-base) hover:shadow-pop',
        card.status === 'error'
          ? 'border-danger/40'
          : card.status === 'needs_reconnect'
            ? 'border-warning/40'
            : 'border-line',
      )}
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-control',
            isConnected ? 'bg-brand-faint text-brand-text' : 'bg-surface-muted text-fg-2',
          )}
        >
          <Glyph className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`int-${card.provider}`} className="text-panel text-fg">
            {t(`providers.${card.provider}.name`)}
          </h2>
          <p className="mt-0.5 text-meta text-fg-muted" data-testid="last-ok">
            {t('lastOk', {
              when: conn?.lastOkAt ? fmt.relativeTime(new Date(conn.lastOkAt), now) : t('never'),
            })}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-2 rounded-chip px-2.5 py-1 text-meta font-medium',
            {
              success: 'bg-success-surface text-success',
              danger: 'bg-danger-surface text-danger',
              warning: 'bg-warning-surface text-warning',
              neutral: 'bg-neutral-surface text-neutral',
              info: 'bg-info-surface text-info',
              disabled: 'bg-neutral-surface text-fg-muted',
            }[STATUS_TONE[card.status]],
          )}
          data-status={card.status}
        >
          {card.status === 'error' || card.status === 'needs_reconnect' ? (
            <TriangleAlert aria-hidden className="size-3.5" />
          ) : (
            <span aria-hidden className="live-dot" data-live={isConnected} />
          )}
          {t(`status.${card.status}`)}
        </span>
      </header>

      <div className="mt-4 space-y-3">
        {card.platformDefault && !conn?.secretsHint ? (
          <p className="flex items-center gap-2 text-meta text-fg-2">
            <KeyRound aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
            {t('platformDefault')}
          </p>
        ) : null}
        {conn && conn.health.state !== 'closed' ? (
          <p
            role="status"
            className={cn(
              'flex items-start gap-2 rounded-control px-3 py-2 text-meta font-medium',
              breaker === 'open' ? 'bg-warning-surface text-warning' : 'bg-info-surface text-info',
            )}
          >
            {breaker === 'open' ? (
              <Pause aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <RotateCw aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            )}
            {t(`breaker.${breaker}`)}
          </p>
        ) : null}
        {card.deadJobs > 0 ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-control bg-danger-surface px-3 py-2 text-meta font-medium text-danger"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t('deadJobs', { count: card.deadJobs })}
          </p>
        ) : null}
        {card.provider === 'slack' ? (
          <div>
            <p className="text-meta text-fg-2">
              {t('slackCoverage', { linked: slack.linkedUsers, total: slack.totalUsers })}
            </p>
            <div
              role="meter"
              aria-label={t('slackCoverage', { linked: slack.linkedUsers, total: slack.totalUsers })}
              aria-valuemin={0}
              aria-valuemax={slack.totalUsers || 1}
              aria-valuenow={slack.linkedUsers}
              className="mt-1.5 h-1.5 overflow-hidden rounded-chip bg-surface-muted"
            >
              <div
                className="h-full rounded-chip bg-brand"
                style={{ width: `${slack.totalUsers ? (slack.linkedUsers / slack.totalUsers) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : null}

        <p className="text-meta leading-relaxed text-fg-muted">{t(`providers.${card.provider}.limits`)}</p>

        {card.webhookUrls.length ? (
          <div className="space-y-1.5">
            <p className="text-meta font-medium text-fg">{t('webhookUrls')}</p>
            <ul className="space-y-1.5">
              {card.webhookUrls.map((u) => (
                <li key={u.url}>
                  <CopyField label={t(u.label as 'webhook')} value={u.url} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <button
            type="button"
            onClick={() => setShowErrors((v) => !v)}
            aria-expanded={showErrors}
            disabled={card.recentErrors.length === 0}
            className="inline-flex items-center gap-1.5 rounded-control text-meta font-medium text-fg disabled:cursor-default"
          >
            {card.recentErrors.length === 0 ? (
              <>
                <Check aria-hidden className="size-3.5 text-success" />
                {t('noErrors')}
              </>
            ) : (
              <>
                <TriangleAlert aria-hidden className="size-3.5 text-warning" />
                {t('recentErrorsCount', { count: card.recentErrors.length })}
              </>
            )}
          </button>
          <Collapse open={showErrors && card.recentErrors.length > 0}>
            <ul className="mt-2 divide-y divide-line rounded-control border border-line">
              {card.recentErrors.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 px-3 py-2 text-meta">
                  <span className="text-fg-2">
                    {t.has(`errorCodes.${e.error ?? ''}`)
                      ? t(`errorCodes.${e.error}` as 'errorCodes.generic')
                      : t('errorCodes.generic')}
                  </span>
                  <time dateTime={e.createdAt} className="shrink-0 text-fg-muted tabular">
                    {fmt.dateTime(new Date(e.createdAt), { dateStyle: 'short', timeStyle: 'short' })}
                  </time>
                </li>
              ))}
            </ul>
          </Collapse>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-control bg-danger-surface px-3 py-2 text-meta text-danger"
        >
          <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {card.connectable ? (
        <div className="mt-auto pt-5">
          <Collapse open={editing}>
            <form
              onSubmit={submit}
              className="mb-4 space-y-3 rounded-control border border-line bg-surface-muted/50 p-4"
            >
              {[...card.publicFields, ...card.secretFields].map((f) => {
                const isSecret = card.secretFields.includes(f);
                return (
                  <FormField
                    key={f}
                    label={t(`fields.${f}` as 'fields.apiKey')}
                    helper={
                      isSecret && conn?.secretFieldsSet.includes(f)
                        ? t('secretHint', { hint: conn.secretsHint ?? '••••' })
                        : undefined
                    }
                  >
                    {(p) => (
                      <Input
                        {...p}
                        name={f}
                        type={isSecret ? 'password' : 'text'}
                        autoComplete="off"
                        dir="ltr"
                        defaultValue={isSecret ? '' : (conn?.publicConfig[f] ?? '')}
                      />
                    )}
                  </FormField>
                );
              })}
              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={busy}>
                  {t('actions.save')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  {t('actions.cancel')}
                </Button>
              </div>
            </form>
          </Collapse>
          {!editing ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                <Icon icon={PlugZap} />
                {conn?.secretFieldsSet.length ? t('actions.update') : t('actions.connect')}
              </Button>
              {conn?.secretFieldsSet.length ? (
                <Button type="button" variant="ghost" onClick={() => void disconnect()}>
                  <Icon icon={Unplug} />
                  {t('actions.disconnect')}
                </Button>
              ) : null}
              {conn ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="ms-auto"
                  onClick={() => void breakerTo(conn.health.state === 'open' ? 'closed' : 'open')}
                >
                  <Icon icon={conn.health.state === 'open' ? Play : Pause} />
                  {conn.health.state === 'open' ? t('actions.forceClosed') : t('actions.forceOpen')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations('integrations');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-control border border-line bg-surface-muted/60 py-1 ps-3 pe-1">
      <span className="shrink-0 text-meta text-fg-muted">{label}</span>
      <code dir="ltr" className="min-w-0 flex-1 truncate text-meta text-fg">
        {value}
      </code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 sm:size-8"
        aria-label={copied ? t('copied') : t('copy', { label })}
        onClick={async () => {
          await navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Icon icon={copied ? Check : Copy} className={copied ? 'text-success' : undefined} />
      </Button>
    </div>
  );
}

const PROVIDERS: IntegrationProvider[] = ['meta_whatsapp', 'stripe', 'google_calendar', 'slack', 'openai'];

function SyncHistory() {
  const t = useTranslations('integrations');
  const fmt = useFormatter();
  const [provider, setProvider] = useState<IntegrationProvider | ''>('');
  const [rows, setRows] = useState<IntegrationEventDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);

  const fetchPage = useCallback(
    (before?: string) =>
      api.integrations.events({
        query: { limit: 25, ...(provider ? { provider } : {}), ...(before ? { before } : {}) },
      }),
    [provider],
  );

  useEffect(() => {
    let live = true;
    fetchPage().then(
      (r) => {
        if (!live) return;
        setRows(r.events);
        setNext(r.nextBefore);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [fetchPage]);

  const columns: Column<IntegrationEventDto>[] = [
    {
      id: 'time',
      header: t('history.columns.time'),
      mobile: 'title',
      cell: (e) => (
        <time dateTime={e.createdAt} className="text-meta text-fg-2 tabular">
          {fmt.dateTime(new Date(e.createdAt), { dateStyle: 'medium', timeStyle: 'medium' })}
        </time>
      ),
    },
    {
      id: 'provider',
      header: t('history.columns.provider'),
      cell: (e) => {
        const G = PROVIDER_ICON[e.provider];
        return (
          <span className="inline-flex items-center gap-2 text-body text-fg">
            <G aria-hidden className="size-4 text-fg-2" />
            {t(`providers.${e.provider}.name`)}
          </span>
        );
      },
    },
    {
      id: 'direction',
      header: t('history.columns.direction'),
      cell: (e) => (
        <span className="inline-flex items-center gap-1.5 text-meta text-fg-2">
          <Icon icon={e.direction === 'in' ? ArrowDownLeft : ArrowUpRight} flipInRtl className="size-3.5" />
          {t(`history.direction.${e.direction}`)}
        </span>
      ),
    },
    {
      id: 'kind',
      header: t('history.columns.kind'),
      cell: (e) => (
        <code dir="ltr" className="rounded-[6px] bg-surface-muted px-1.5 py-0.5 text-meta text-fg">
          {e.kind}
        </code>
      ),
    },
    {
      id: 'status',
      header: t('history.columns.status'),
      cell: (e) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={EVENT_TONE[e.status]}>{t(`history.status.${e.status}`)}</StatusBadge>
          {e.error ? (
            <span className="text-meta text-fg-muted">
              {t.has(`errorCodes.${e.error}`) ? t(`errorCodes.${e.error}` as 'errorCodes.generic') : e.error}
            </span>
          ) : null}
          {e.duplicateCount > 0 ? (
            <span className="text-meta text-fg-muted">
              {t('history.duplicates', { count: e.duplicateCount })}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'http',
      header: t('history.columns.http'),
      align: 'end',
      cell: (e) => (
        <Ltr className="text-meta text-fg-2 tabular">
          {e.httpStatus ?? '—'}
          {e.latencyMs !== null ? (
            <span className="text-fg-muted"> · {t('history.ms', { ms: e.latencyMs })}</span>
          ) : null}
        </Ltr>
      ),
    },
  ];

  return (
    <section aria-labelledby="sync-history" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-control bg-surface text-fg-2 shadow-card"
          >
            <History className="size-4" />
          </span>
          <div>
            <h2 id="sync-history" className="text-panel text-fg">
              {t('history.title')}
            </h2>
            <p className="text-meta text-fg-muted">{t('history.subtitle')}</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-meta text-fg-2">
          <span>{t('history.filter')}</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as IntegrationProvider | '')}
            className={cn(fieldClass, 'h-10 w-auto min-w-44')}
          >
            <option value="">{t('history.all')}</option>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {t(`providers.${p}.name`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {failed ? (
        <p role="alert" className="flex items-center gap-2 text-body text-danger">
          <CircleAlert aria-hidden className="size-4" />
          {t('history.loadFailed')}
        </p>
      ) : (
        <DataTable
          caption={t('history.title')}
          columns={columns}
          rows={rows ?? []}
          loading={!rows}
          rowKey={(e) => e.id}
          empty={
            <div className="rounded-card border border-dashed border-line-strong bg-surface">
              <EmptyState icon={History} title={t('history.empty')} headingLevel={3} />
            </div>
          }
          footer={
            next ? (
              <Button
                variant="secondary"
                loading={more}
                onClick={async () => {
                  setMore(true);
                  try {
                    const r = await fetchPage(next);
                    setRows((x) => [...(x ?? []), ...r.events]);
                    setNext(r.nextBefore);
                  } finally {
                    setMore(false);
                  }
                }}
              >
                {t('history.loadMore')}
              </Button>
            ) : undefined
          }
        />
      )}
    </section>
  );
}
