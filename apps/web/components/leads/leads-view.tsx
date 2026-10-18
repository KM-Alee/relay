'use client';
// Leads list + manual entry (F3.1, F3.4). Live via realtime hints on the `leads` topic (qk.leads.*).
import type { CreateLeadInput, LeadSummary } from '@relay/contracts/api/leads';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';
import { Link } from '@/lib/i18n/navigation';
import { qk } from '@/lib/query/keys';
import { useRealtimeLive } from '@/lib/realtime/useRealtime';
import { AcknowledgeButton, LeadCountdown, LeadOwner, LeadStateBadge } from './lead-parts';

export interface LeadsDrill {
  state?: 'pending';
  created?: 'today';
  escalated?: 'today' | '24h';
}

export function LeadsView({
  canViewAll,
  canCreate,
  drill = {},
}: {
  canViewAll: boolean;
  canCreate: boolean;
  /** Overview drill-down (F5.3): the list equals the figure that linked here. */
  drill?: LeadsDrill;
}) {
  const t = useTranslations('leads');
  const [view, setView] = useState<'mine' | 'all'>(canViewAll ? 'all' : 'mine');
  const drillKey = drill.state
    ? 'pending'
    : drill.created
      ? 'createdToday'
      : drill.escalated === 'today'
        ? 'escalatedToday'
        : drill.escalated
          ? 'escalated24h'
          : null;
  const q = useQuery({
    queryKey: qk.leads.list({ view, ...drill }),
    queryFn: ({ signal }) => api.leads.list({ view, ...drill }, { signal }),
  });
  useRealtimeLive(); // visible countdowns: 1 s hints while this page is open

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page font-semibold text-fg">{t('list.title')}</h1>
        {canViewAll ? (
          <div role="group" className="inline-flex gap-2">
            {(['mine', 'all'] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={view === v ? 'primary' : 'secondary'}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {t(`list.${v}`)}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {drillKey ? (
        <p className="flex flex-wrap items-center gap-3 text-body text-fg-2" data-testid="leads-drill">
          <span>{t(`list.drill.${drillKey}`, { count: q.data?.items.length ?? 0 })}</span>
          <Link href="/leads" className="text-brand-text hover:underline">
            {t('list.drill.clear')}
          </Link>
        </p>
      ) : null}
      {canCreate && !drillKey ? <NewLeadForm /> : null}
      {q.isError ? (
        <p role="alert" className="text-danger">
          {t('list.loadFailed')}
        </p>
      ) : q.isPending ? (
        <p aria-busy="true" className="text-fg-2">
          {t('list.loading')}
        </p>
      ) : q.data.items.length === 0 ? (
        <p className="text-fg-2">{t('list.empty')}</p>
      ) : (
        <LeadsTable items={q.data.items} />
      )}
    </div>
  );
}

function LeadsTable({ items }: { items: readonly LeadSummary[] }) {
  const t = useTranslations('leads');
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full text-body">
        <thead className="text-start text-meta text-fg-2">
          <tr>
            <th className="px-4 py-2 text-start">{t('list.colContact')}</th>
            <th className="px-4 py-2 text-start">{t('list.colState')}</th>
            <th className="px-4 py-2 text-start">{t('list.colOwner')}</th>
            <th className="px-4 py-2 text-start">{t('list.colCountdown')}</th>
            <th className="px-4 py-2 text-start">{t('list.colSource')}</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id} className="border-t border-line" data-lead-id={l.id}>
              <td className="px-4 py-3">
                <Link href={`/leads/${l.id}`} className="font-medium text-fg hover:underline">
                  {l.contactName}
                </Link>
              </td>
              <td className="px-4 py-3">
                <LeadStateBadge state={l.state} />
              </td>
              <td className="px-4 py-3">
                <LeadOwner lead={l} />
              </td>
              <td className="px-4 py-3">
                <LeadCountdown lead={l} size={20} />
              </td>
              <td className="px-4 py-3 text-fg-2">{l.sourceLabel}</td>
              <td className="px-4 py-3 text-end">
                <AcknowledgeButton lead={l} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewLeadForm() {
  const t = useTranslations('leads.new');
  const qc = useQueryClient();
  const sources = useQuery({
    queryKey: ['leads', 'sources'],
    queryFn: ({ signal }) => api.leads.sources({ signal }),
  });
  const create = useMutation({
    mutationFn: (body: CreateLeadInput) => api.leads.create(body),
    onSuccess: () => {
      toast.success(t('created'));
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: () => toast.error(t('failed')),
  });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim() || undefined;
    create.mutate({
      contactName: s('contactName') ?? '',
      phone: s('phone'),
      email: s('email'),
      message: s('message'),
      sourceKey: s('sourceKey') ?? '',
      isUrgent: f.get('isUrgent') === 'on',
    });
    e.currentTarget.reset();
  };
  const field =
    'mt-1 block w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-body text-fg';
  return (
    <details className="rounded-card border border-line bg-surface p-4">
      <summary className="cursor-pointer font-medium text-fg">{t('title')}</summary>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-meta text-fg-2">
          {t('name')}
          <input name="contactName" required maxLength={200} className={field} />
        </label>
        <label className="text-meta text-fg-2">
          {t('source')}
          <select name="sourceKey" required className={field}>
            {(sources.data?.items ?? []).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-meta text-fg-2">
          {t('phone')}
          <input name="phone" type="tel" dir="ltr" className={field} />
        </label>
        <label className="text-meta text-fg-2">
          {t('email')}
          <input name="email" type="email" dir="ltr" className={field} />
        </label>
        <label className="text-meta text-fg-2 sm:col-span-2">
          {t('message')}
          <textarea name="message" rows={2} className={field} />
        </label>
        <label className="inline-flex items-center gap-2 text-body text-fg">
          <input name="isUrgent" type="checkbox" /> {t('urgent')}
        </label>
        <div className="text-end">
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {t('submit')}
          </Button>
        </div>
      </form>
    </details>
  );
}
