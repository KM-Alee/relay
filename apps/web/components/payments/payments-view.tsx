'use client';
// Payments page body (I2.1, I2.2, I2.5-I2.7). Plain semantic markup + logical-property classes until Lane D's
// design system lands. Live: refetches every 3 s while a request is pending, so "Paid ✓" appears without a
// manual refresh once the webhook is processed (the realtime hint also invalidates this when the shell mounts it).
import type { PaymentRequestDto, PaymentsListResponse } from '@relay/contracts/api/payments';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, localizeError } from '@/lib/api-client';

type Fmt = ReturnType<typeof useFormatter>;

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
  const tr = useTranslations();
  const fmt = useFormatter();
  const [data, setData] = useState<PaymentsListResponse | null>(null);
  const [failed, setFailed] = useState(false);

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

  const anyPending = data?.requests.some((r) => r.status === 'pending') ?? false;
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => void load(), 3000);
    return () => clearInterval(id);
  }, [anyPending, load]);

  if (failed && !data) return <p role="alert">{t('loadFailed')}</p>;
  if (!data) return <p aria-busy="true">{t('loading')}</p>;

  const fig = (f: { value: number | null; masked: boolean }) =>
    f.masked || f.value === null
      ? t('totals.masked')
      : fmt.number(f.value / 100, { style: 'currency', currency: data.totals.currency });

  return (
    <div className="space-y-8">
      <section aria-label={t('totals.collected')} className="grid gap-4 sm:grid-cols-3">
        <Stat label={t('totals.collected')} value={fig(data.totals.collected)} />
        <Stat label={t('totals.projected')} value={fig(data.totals.projected)} />
        <Stat label={t('totals.refunded')} value={fig(data.totals.refunded)} />
      </section>

      <NewLinkForm onCreated={load} />

      {data.requests.length === 0 ? (
        <p className="opacity-70">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="text-start opacity-70">
                <th className="py-2 pe-4 text-start">{t('columns.opportunity')}</th>
                <th className="py-2 pe-4 text-start">{t('columns.amount')}</th>
                <th className="py-2 pe-4 text-start">{t('columns.status')}</th>
                <th className="py-2 pe-4 text-start">{t('columns.reference')}</th>
                <th className="py-2 pe-4 text-start">{t('columns.created')}</th>
                <th className="py-2 text-start">{t('columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.requests.map((r) => (
                <Row key={r.id} r={r} fmt={fmt} onChanged={load} tr={tr} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm opacity-70">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function Row({
  r,
  fmt,
  onChanged,
  tr,
}: {
  r: PaymentRequestDto;
  fmt: Fmt;
  onChanged: () => Promise<void>;
  tr: ReturnType<typeof useTranslations>;
}) {
  const t = useTranslations('payments');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hidden = t('totals.masked');
  return (
    <tr className="border-t align-top">
      <td className="py-2 pe-4 font-mono text-xs">{r.opportunityId.slice(0, 8)}</td>
      <td className="py-2 pe-4">
        {money(fmt, r.amount, hidden)}
        {r.displayText ? <div className="text-xs opacity-70">{r.displayText}</div> : null}
      </td>
      <td className="py-2 pe-4">
        <span data-status={r.status}>{t(`status.${r.status}`)}</span>
        {r.failureReason ? (
          <div className="text-xs opacity-70">{t('failureReason', { reason: r.failureReason })}</div>
        ) : null}
        {error ? (
          <div role="alert" className="text-xs">
            {error}
          </div>
        ) : null}
      </td>
      <td className="py-2 pe-4">
        {r.dashboardUrl && r.providerRef ? (
          <a className="underline" href={r.dashboardUrl} target="_blank" rel="noreferrer">
            {r.providerRef.slice(0, 18)}…
          </a>
        ) : (
          <span className="opacity-70">{t('preparing')}</span>
        )}
      </td>
      <td className="py-2 pe-4">
        {fmt.dateTime(new Date(r.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
      </td>
      <td className="flex flex-wrap gap-3 py-2">
        {r.url && r.status === 'pending' ? (
          <>
            <a className="underline" href={r.url} target="_blank" rel="noreferrer">
              {t('actions.open')}
            </a>
            <button
              type="button"
              className="underline"
              onClick={async () => {
                await navigator.clipboard?.writeText(r.url!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? t('actions.copied') : t('actions.copy')}
            </button>
          </>
        ) : null}
        {r.status === 'pending' ? (
          <button
            type="button"
            className="underline"
            onClick={async () => {
              try {
                await api.payments.cancel({ params: { id: r.id } });
                await onChanged();
              } catch (e) {
                setError(localizeError(e, tr));
              }
            }}
          >
            {t('actions.cancel')}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function NewLinkForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const t = useTranslations('payments');
  const tr = useTranslations();
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
      await onCreated();
    } catch (err) {
      setError(localizeError(err, tr) || t('createFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold">{t('form.title')}</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block text-sm">
          {t('form.opportunityId')}
          <input
            name="opportunityId"
            required
            pattern="[0-9a-fA-F-]{36}"
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          {t('form.amount')}
          <input
            name="amount"
            type="number"
            min="1"
            step="0.01"
            required
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          {t('form.currency')}
          <select name="currency" defaultValue="PKR" className="mt-1 w-full rounded border px-2 py-1">
            <option value="PKR">PKR</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="block text-sm">
          {t('form.description')}
          <input name="description" maxLength={200} className="mt-1 w-full rounded border px-2 py-1" />
        </label>
      </div>
      <p className="text-xs opacity-70">{t('form.hint')}</p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={busy} className="rounded border px-3 py-1">
        {busy ? t('actions.creating') : t('actions.create')}
      </button>
    </form>
  );
}
