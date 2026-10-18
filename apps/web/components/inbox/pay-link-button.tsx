'use client';
// "$" button in the inbox composer (T-216, I2.1): create a Stripe payment link for the contact's open
// opportunity and send it in this WhatsApp thread. Amount is optional: it defaults to the opportunity value
// (server side), and is required when that value is empty or hidden from the user (F1.4).
import { CircleDollarSign } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { ApiError, api, localizeError } from '@/lib/api-client';

const REASONS = [
  'no_open_opportunity',
  'no_contact',
  'no_conversation',
  'payment_link_unavailable',
  'opted_out',
];

export function PayLinkButton({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: () => Promise<void>;
}) {
  const t = useTranslations('inbox');
  const tr = useTranslations();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const major = amount.trim() === '' ? null : Number(amount);
    if (major !== null && (!Number.isFinite(major) || major <= 0)) {
      setError(t('pay.badAmount'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.payments.sendInConversation({
        params: { id: conversationId },
        body: {
          ...(major !== null ? { amountMinor: Math.round(major * 100) } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        },
      });
      toast.success(t('pay.sent'));
      setOpen(false);
      setAmount('');
      setDescription('');
      await onSent();
    } catch (err) {
      const d = err instanceof ApiError ? err.details : undefined;
      const reason = d?.reason as string | undefined;
      const issues = (d?.issues as Array<{ path?: string }> | undefined) ?? [];
      setError(
        reason && REASONS.includes(reason)
          ? t(`pay.reason.${reason}`)
          : issues.some((i) => i.path === 'amountMinor')
            ? t('pay.amountRequired')
            : localizeError(err, tr),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-label={t('pay.button')}
        title={t('pay.button')}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleDollarSign className="size-4" aria-hidden="true" />
        <span aria-hidden="true">$</span>
      </Button>
      {open ? (
        <form
          onSubmit={submit}
          className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3"
        >
          <p className="text-meta text-fg-2">{t('pay.help')}</p>
          <label className="text-meta text-fg-2" htmlFor="pay-amount">
            {t('pay.amount')}
          </label>
          <Input
            id="pay-amount"
            inputMode="decimal"
            placeholder={t('pay.amountPlaceholder')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label className="text-meta text-fg-2" htmlFor="pay-desc">
            {t('pay.description')}
          </label>
          <Input
            id="pay-desc"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {error ? (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" size="sm" loading={busy}>
            {t('pay.send')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
