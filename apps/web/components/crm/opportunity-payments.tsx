'use client';
// Payments for one opportunity (I2.1, I2.5; rubric 6): "Send payment link" (permission payments.request),
// the link with Copy + "Send via WhatsApp", and live status badges (realtime topic `payments` invalidates the query).
import type { PaymentRequestDto } from '@relay/contracts/api/payments';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, CreditCard, MessageCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { StatusBadge, type StatusTone } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';

const TONE: Record<PaymentRequestDto['status'], StatusTone> = {
  pending: 'info',
  paid: 'success',
  failed: 'danger',
  expired: 'neutral',
  refunded: 'warning',
  partially_refunded: 'warning',
};

export function PaymentStatusBadge({ status }: { status: PaymentRequestDto['status'] }) {
  const t = useTranslations('crm.payments.status');
  return <StatusBadge tone={TONE[status]}>{t(status)}</StatusBadge>;
}

export function OpportunityPayments({
  opportunityId,
  contactId,
  hasPhone,
  defaultValue,
}: {
  opportunityId: string;
  contactId: string;
  hasPhone: boolean;
  /** Visible opportunity value in minor units (null when masked or unset). */
  defaultValue: { amountMinor: number; currency: string } | null;
}) {
  const t = useTranslations('crm.payments');
  const tr = useTranslations();
  const fmt = useFormatter();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['payments', 'opportunity', opportunityId],
    queryFn: () => api.payments.list({ query: { opportunityId, limit: 20 } }),
    // Pending links change without a user action (the customer pays): poll lightly on top of the change feed.
    refetchInterval: (q) => (q.state.data?.requests.some((r) => r.status === 'pending') ? 5000 : false),
  });
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(defaultValue ? String(defaultValue.amountMinor / 100) : '');
  const [busy, setBusy] = useState<string | null>(null);

  const reasonText = (err: unknown) => {
    const reason = (err as { details?: { reason?: string } }).details?.reason;
    return reason &&
      ['no_conversation', 'window_closed', 'opted_out', 'payment_link_unavailable'].includes(reason)
      ? t(`reason.${reason}` as 'reason.no_conversation')
      : localizeError(err, tr as never);
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy('create');
    try {
      const minor = amount.trim() ? Math.round(Number(amount) * 100) : undefined;
      await api.payments.createLink({
        params: { id: opportunityId },
        body: { contactId, ...(minor ? { amountMinor: minor, currency: defaultValue?.currency } : {}) },
      });
      toast.success(t('created'));
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['payments'] });
    } catch (err) {
      toast.error(reasonText(err));
    } finally {
      setBusy(null);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  async function sendWhatsapp(id: string) {
    setBusy(id);
    try {
      await api.payments.sendWhatsapp({ params: { id } });
      toast.success(t('sent'));
    } catch (err) {
      toast.error(reasonText(err));
    } finally {
      setBusy(null);
    }
  }

  const requests = list.data?.requests ?? [];
  return (
    <div className="space-y-2" data-testid={`opp-payments-${opportunityId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <CreditCard aria-hidden className="size-4" />
          {t('send')}
        </Button>
        {requests.length > 0 && (
          <span className="text-meta text-fg-2">{t('count', { count: requests.length })}</span>
        )}
      </div>
      {open && (
        <form
          onSubmit={create}
          className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-surface-muted p-3"
        >
          <label className="flex flex-col gap-1 text-meta text-fg-2">
            {t('amount', { currency: defaultValue?.currency ?? 'PKR' })}
            <input
              inputMode="decimal"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              required={!defaultValue}
              onChange={(e) => setAmount(e.target.value)}
              className="h-10 w-40 rounded-control border border-line-strong bg-surface px-3 text-body text-fg"
            />
          </label>
          <Button type="submit" variant="primary" size="sm" loading={busy === 'create'}>
            {t('create')}
          </Button>
        </form>
      )}
      {requests.length > 0 && (
        <ul className="space-y-2">
          {requests.map((r) => (
            <li key={r.id} className="rounded-control border border-line bg-surface p-2">
              <div className="flex flex-wrap items-center gap-2">
                <PaymentStatusBadge status={r.status} />
                <span className="text-body text-fg">
                  {r.displayText ??
                    (r.amount.masked
                      ? t('hidden')
                      : fmt.number(r.amount.amountMinor / 100, {
                          style: 'currency',
                          currency: r.amount.currency,
                        }))}
                </span>
                <span className="text-meta text-fg-muted">
                  {fmt.dateTime(new Date(r.paidAt ?? r.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              {r.failureReason && <p className="mt-1 text-meta text-danger">{r.failureReason}</p>}
              {r.status === 'pending' &&
                (r.url ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                      className="max-w-full truncate text-meta text-brand-text underline"
                    >
                      {r.url}
                    </a>
                    <Button size="sm" variant="secondary" onClick={() => copy(r.url!)}>
                      <Copy aria-hidden className="size-4" />
                      {t('copy')}
                    </Button>
                    {hasPhone && (
                      <Button
                        size="sm"
                        variant="primary"
                        loading={busy === r.id}
                        onClick={() => sendWhatsapp(r.id)}
                      >
                        <MessageCircle aria-hidden className="size-4" />
                        {t('sendWhatsapp')}
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-meta text-fg-2">{t('preparing')}</p>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
