'use client';
// Payments page body (I2.1, I2.2, I2.5-I2.7). Data logic by Lane C; design by Lane D3 (T-228).
// Live: refetches every 3 s while a request is pending, so "Paid ✓" appears without a manual refresh once the
// webhook is processed. Collected vs projected stay separate figures (I2.6). A request that flips to paid
// WHILE you watch gets a one-shot celebration + toast: it's a server-confirmed state, never optimistic.
import type { PaymentRequestDto, PaymentsListResponse } from '@relay/contracts/api/payments';
import {
  CircleAlert,
  Copy,
  ExternalLink,
  Hourglass,
  Link2,
  Plus,
  ReceiptText,
  RotateCw,
  Undo2,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/relay/confirm-dialog';
import { DataTable, type Column } from '@/components/relay/data-table';
import { EmptyState } from '@/components/relay/empty-state';
import { FormField } from '@/components/relay/form-field';
import { KpiTile } from '@/components/relay/kpi-tile';
import { RelayLottie } from '@/components/relay/lottie';
import { Ltr } from '@/components/relay/ltr';
import { MaskedValue } from '@/components/relay/masked-value';
import { CountUp } from '@/components/relay/motion/count-up';
import { Stagger, StaggerItem } from '@/components/relay/motion/primitives';
import { StatusBadge, type StatusTone } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input, fieldClass } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { SkeletonGroup } from '@/components/relay/skeleton-group';
import { Tooltip } from '@/components/ui/popover';
import { api, localizeError } from '@/lib/api-client';

type Fmt = ReturnType<typeof useFormatter>;
type Status = PaymentRequestDto['status'];

const STATUS: Record<Status, { tone: StatusTone; icon?: LucideIcon }> = {
  pending: { tone: 'info', icon: Hourglass },
  paid: { tone: 'success' },
  expired: { tone: 'neutral' },
  failed: { tone: 'danger', icon: XCircle },
  refunded: { tone: 'neutral', icon: Undo2 },
  partially_refunded: { tone: 'neutral', icon: Undo2 },
};

function money(
  fmt: Fmt,
  m: { masked: boolean; amountMinor?: number; currency?: string },
  hidden: string,
): string {
  if (m.masked || m.amountMinor === undefined || !m.currency) return hidden;
  return fmt.number(m.amountMinor / 100, { style: 'currency', currency: m.currency });
}

export function PaymentsView() {
  const t = useTranslations('payments');
  const fmt = useFormatter();
  const [data, setData] = useState<PaymentsListResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [celebrating, setCelebrating] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef<Map<string, Status> | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(async () => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    api.payments.list({}).then(
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

  // Detect pending → paid transitions observed in this session (server-confirmed) and celebrate once.
  useEffect(() => {
    if (!data) return;
    const prev = seen.current;
    const next = new Map(data.requests.map((r) => [r.id, r.status] as const));
    seen.current = next;
    if (!prev) return;
    const flipped = data.requests.filter((r) => r.status === 'paid' && prev.get(r.id) === 'pending');
    if (!flipped.length) return;
    for (const r of flipped) {
      toast.success(t('paidToast', { amount: money(fmt, r.amount, t('totals.masked')) }));
    }
    setCelebrating((s) => new Set([...s, ...flipped.map((r) => r.id)]));
    const id = setTimeout(
      () => setCelebrating((s) => new Set([...s].filter((x) => !flipped.some((r) => r.id === x)))),
      2400,
    );
    return () => clearTimeout(id);
  }, [data, fmt, t]);

  const anyPending = data?.requests.some((r) => r.status === 'pending') ?? false;
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [anyPending, load]);

  if (failed && !data)
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

  const currency = data?.totals.currency ?? 'PKR';
  const asMoney = (n: number) => fmt.number(n, { style: 'currency', currency, maximumFractionDigits: 0 });
  const fig = (f: { value: number | null; masked: boolean } | undefined) =>
    !f ? undefined : f.masked || f.value === null ? (
      <MaskedValue />
    ) : (
      <CountUp value={f.value / 100} format={asMoney} />
    );

  const c = data?.totals.collected;
  const p = data?.totals.projected;
  const rate =
    c && p && !c.masked && !p.masked && c.value !== null && p.value !== null && c.value + p.value > 0
      ? c.value / (c.value + p.value)
      : null;

  const columns: Column<PaymentRequestDto>[] = [
    {
      id: 'opportunity',
      header: t('columns.opportunity'),
      mobile: 'title',
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{r.description ?? t('requestFor')}</div>
          <code dir="ltr" className="text-meta text-fg-muted">
            {r.opportunityId.slice(0, 8)}
          </code>
        </div>
      ),
    },
    {
      id: 'amount',
      header: t('columns.amount'),
      align: 'end',
      cell: (r) =>
        r.amount.masked ? (
          <MaskedValue />
        ) : (
          <div className="flex flex-col items-end">
            <Ltr className="font-semibold tabular text-fg">{money(fmt, r.amount, t('totals.masked'))}</Ltr>
            {r.displayText ? <Ltr className="text-meta text-fg-muted">{r.displayText}</Ltr> : null}
          </div>
        ),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (r) => <StatusCell r={r} celebrate={celebrating.has(r.id)} />,
    },
    {
      id: 'reference',
      header: t('columns.reference'),
      cell: (r) =>
        r.dashboardUrl && r.providerRef ? (
          <a
            className="inline-flex items-center gap-1 rounded-control text-meta text-brand-text hover:underline"
            href={r.dashboardUrl}
            target="_blank"
            rel="noreferrer"
          >
            <code dir="ltr">{r.providerRef.slice(0, 14)}…</code>
            <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : (
          <span className="text-meta text-fg-muted">{t('preparing')}</span>
        ),
    },
    {
      id: 'created',
      header: t('columns.created'),
      cell: (r) => (
        <time dateTime={r.createdAt} className="text-meta text-fg-2 tabular">
          {fmt.dateTime(new Date(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (r) => <RowActions r={r} onChanged={load} />,
    },
  ];

  return (
    <div className="space-y-8">
      <Stagger as="section" aria-label={t('totals.label')} className="grid gap-(--card-gap) sm:grid-cols-3">
        <StaggerItem>
          <KpiTile
            icon={<Wallet className="size-4" />}
            label={t('totals.collected')}
            state={data ? 'ready' : 'loading'}
            value={fig(c)}
            compareLabel={t('totals.collectedHint')}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiTile
            icon={<Hourglass className="size-4" />}
            label={t('totals.projected')}
            state={data ? 'ready' : 'loading'}
            value={fig(p)}
            compareLabel={t('totals.projectedHint')}
          />
        </StaggerItem>
        <StaggerItem>
          <KpiTile
            icon={<Undo2 className="size-4" />}
            label={t('totals.refunded')}
            state={data ? 'ready' : 'loading'}
            value={fig(data?.totals.refunded)}
            compareLabel={t('totals.refundedHint')}
          />
        </StaggerItem>
      </Stagger>
      {rate !== null && c?.value != null && p?.value != null ? (
        <div className="-mt-3 rounded-card border border-line bg-surface px-5 py-4 shadow-card">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-meta">
            <span className="inline-flex items-center gap-2 text-fg">
              <span aria-hidden className="size-2.5 rounded-chip bg-brand" />
              {t('totals.collected')}
              <Ltr className="font-semibold tabular">{asMoney(c.value / 100)}</Ltr>
            </span>
            <span className="font-semibold text-fg tabular">
              {t('totals.rate', { pct: fmt.number(rate, { style: 'percent' }) })}
            </span>
            <span className="inline-flex items-center gap-2 text-fg-2">
              <span aria-hidden className="size-2.5 rounded-chip bg-data-b" />
              {t('totals.projected')}
              <Ltr className="font-semibold tabular">{asMoney(p.value / 100)}</Ltr>
            </span>
          </div>
          <div
            role="meter"
            aria-label={t('totals.rate', { pct: fmt.number(rate, { style: 'percent' }) })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(rate * 100)}
            className="h-2 overflow-hidden rounded-chip bg-data-b"
          >
            <div
              className="h-full origin-[inline-start] rounded-chip bg-brand transition-[width] duration-(--dur-slow)"
              style={{ width: `${Math.round(rate * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      <section aria-labelledby="pay-requests" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="pay-requests" className="text-panel text-fg">
              {t('requests.title')}
            </h2>
            {data ? (
              <p className="text-meta text-fg-muted">
                {t('requests.count', { count: data.requests.length })}
              </p>
            ) : null}
          </div>
          <NewLinkDialog onCreated={load} />
        </div>

        {!data ? (
          <SkeletonGroup className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </SkeletonGroup>
        ) : (
          <DataTable
            caption={t('requests.title')}
            columns={columns}
            rows={data.requests}
            rowKey={(r) => r.id}
            empty={
              <div className="rounded-card border border-dashed border-line-strong bg-surface">
                <EmptyState icon={ReceiptText} title={t('emptyTitle')} description={t('empty')} />
              </div>
            }
          />
        )}
      </section>
    </div>
  );
}

function StatusCell({ r, celebrate }: { r: PaymentRequestDto; celebrate: boolean }) {
  const t = useTranslations('payments');
  const meta = STATUS[r.status];
  return (
    <div className="relative inline-flex flex-col items-start gap-1">
      {celebrate ? (
        <RelayLottie
          name="celebrate"
          className="pointer-events-none absolute -top-10 start-1/2 z-10 size-28 -translate-x-1/2 rtl:translate-x-1/2"
        />
      ) : null}
      <StatusBadge tone={meta.tone} icon={meta.icon} strong={r.status === 'paid'}>
        {t(`status.${r.status}`)}
      </StatusBadge>
      {r.failureReason ? (
        <span className="text-meta text-fg-muted">{t('failureReason', { reason: r.failureReason })}</span>
      ) : null}
    </div>
  );
}

function RowActions({ r, onChanged }: { r: PaymentRequestDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('payments');
  const tr = useTranslations();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (r.status !== 'pending') return null;
  return (
    <div className="flex items-center justify-end gap-1">
      {r.url ? (
        <>
          <Tooltip content={t('actions.open')}>
            <Button asChild size="icon" variant="ghost" className="size-9 sm:size-9">
              <a href={r.url} target="_blank" rel="noreferrer" aria-label={t('actions.open')}>
                <Icon icon={ExternalLink} />
              </a>
            </Button>
          </Tooltip>
          <Tooltip content={t('actions.copy')}>
            <Button
              size="icon"
              variant="ghost"
              className="size-9 sm:size-9"
              aria-label={t('actions.copy')}
              onClick={async () => {
                await navigator.clipboard?.writeText(r.url!);
                toast.success(t('actions.copied'));
              }}
            >
              <Icon icon={Copy} />
            </Button>
          </Tooltip>
        </>
      ) : null}
      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirm(true)}>
        {t('actions.cancel')}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('cancelConfirm.title')}
        description={t('cancelConfirm.body')}
        confirmLabel={t('actions.cancel')}
        destructive
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.payments.cancel({ params: { id: r.id } });
            setConfirm(false);
            await onChanged();
          } catch (e) {
            toast.error(localizeError(e, tr));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function NewLinkDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const t = useTranslations('payments');
  const tr = useTranslations();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.payments.createLink({
        params: { id: String(f.get('opportunityId')).trim() },
        body: {
          amountMinor: Math.round(Number(f.get('amount')) * 100),
          currency: String(f.get('currency')),
          ...(String(f.get('description')).trim()
            ? { description: String(f.get('description')).trim() }
            : {}),
        },
      });
      setOpen(false);
      toast.success(t('created'));
      await onCreated();
    } catch (err) {
      setError(localizeError(err, tr) || t('createFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Icon icon={Plus} />
          {t('actions.create')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('form.title')} description={t('form.hint')}>
        <form onSubmit={submit} className="space-y-4">
          <FormField label={t('form.opportunityId')} required>
            {(p) => <Input {...p} name="opportunityId" required pattern="[0-9a-fA-F-]{36}" dir="ltr" />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField label={t('form.amount')} required>
              {(p) => <Input {...p} name="amount" type="number" min="1" step="0.01" required dir="ltr" />}
            </FormField>
            <FormField label={t('form.currency')}>
              {(p) => (
                <select {...p} name="currency" defaultValue="PKR" className={`${fieldClass} h-11 sm:h-10`}>
                  {['PKR', 'USD'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
          <FormField label={t('form.description')}>
            {(p) => <Input {...p} name="description" maxLength={200} />}
          </FormField>
          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-control bg-danger-surface px-3 py-2 text-meta text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('form.close')}
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              <Icon icon={Link2} />
              {busy ? t('actions.creating') : t('actions.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
