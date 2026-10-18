'use client';
// Lead detail: state, accountable owner, countdown, Acknowledge, ownership timeline + routing trace (F3.4, F3.11).
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { api } from '@/lib/api-client';
import { Link } from '@/lib/i18n/navigation';
import { qk } from '@/lib/query/keys';
import { useRealtimeLive } from '@/lib/realtime/useRealtime';
import { AcknowledgeButton, LeadCountdown, LeadOwner, LeadStateBadge, useTraceSentence } from './lead-parts';

export function LeadDetailView({ id }: { id: string }) {
  const t = useTranslations('leads');
  const fmt = useFormatter();
  const sentence = useTraceSentence();
  const q = useQuery({
    queryKey: qk.leads.detail(id),
    queryFn: ({ signal }) => api.leads.get(id, { signal }),
  });
  useRealtimeLive();

  if (q.isError)
    return (
      <p role="alert" className="text-danger">
        {t('detail.loadFailed')}
      </p>
    );
  if (q.isPending) return <p aria-busy="true">{t('list.loading')}</p>;
  const lead = q.data;
  return (
    <div className="space-y-6">
      <Link href="/leads" className="text-meta text-brand-text hover:underline">
        {t('detail.back')}
      </Link>
      <section className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface p-4">
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-page font-semibold text-fg">{lead.contactName}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <LeadStateBadge state={lead.state} />
            {lead.awaitingReason ? (
              <span className="text-meta text-fg-2">{t(`awaiting.${lead.awaitingReason}`)}</span>
            ) : null}
          </div>
          <LeadOwner lead={lead} />
          <p className="text-meta text-fg-2">
            {t('detail.counters', {
              escalations: lead.escalationCount,
              overdue: lead.overdueAttemptCount,
              idle: lead.idleRetriggerCount,
            })}
          </p>
        </div>
        <LeadCountdown lead={lead} size={96} />
        <AcknowledgeButton lead={lead} />
      </section>
      {lead.message ? (
        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="mb-2 font-medium text-fg">{t('detail.message')}</h2>
          <p className="whitespace-pre-wrap text-body text-fg">{lead.message}</p>
        </section>
      ) : null}
      <section className="rounded-card border border-line bg-surface p-4">
        <h2 className="mb-3 font-medium text-fg">{t('detail.timeline')}</h2>
        <ol className="space-y-3">
          {lead.events.map((e) => (
            <li key={e.id} className="border-s-2 border-line ps-3" data-event-type={e.type}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-fg">
                  {t.has(`event.${e.type}`) ? t(`event.${e.type}`) : e.type}
                </span>
                {e.to ? (
                  <span className="text-meta text-fg-2">
                    {e.from && e.from.id !== e.to.id
                      ? t('event.fromTo', { from: e.from.name, to: e.to.name })
                      : t('event.to', { to: e.to.name })}
                  </span>
                ) : null}
                <time className="text-meta text-fg-muted" dateTime={e.occurredAt}>
                  {fmt.dateTime(new Date(e.occurredAt), { timeStyle: 'medium' })}
                </time>
              </div>
              {e.trace?.length ? <p className="text-meta text-fg-2">{sentence(e.trace)}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
