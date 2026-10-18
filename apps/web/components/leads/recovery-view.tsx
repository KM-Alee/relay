'use client';
// Recovery queue (F3.7, docs/design/screens.md §5): a prioritized list, not charts. Reason badges R1–R5,
// time since the window ended, escalation count, accountable owner (fallback flagged), ONE recommended
// action. Filters per reason (each criterion independently active) + "mine". Live via `recovery` hints.
import type { RecoveryItem, RecoveryReason } from '@relay/contracts/api/leads';
import { useQuery } from '@tanstack/react-query';
import { PartyPopper } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/relay/empty-state';
import { OwnerChip } from '@/components/relay/owner-chip';
import { PageHeader } from '@/components/relay/page-header';
import { StatusBadge, type StatusTone } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { useRealtimeLive } from '@/lib/realtime/useRealtime';
import { ReassignDialog, TakeOverButton } from './lead-actions';

const REASONS: readonly RecoveryReason[] = ['critical', 'overdue', 'escalated2', 'idle', 'awaiting'];
const TONE: Record<RecoveryReason, StatusTone> = {
  critical: 'danger',
  overdue: 'danger',
  escalated2: 'warning',
  idle: 'neutral',
  awaiting: 'warning',
};

function since(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}

export function RecoveryView({
  initialReason,
  initialMine,
}: {
  initialReason: RecoveryReason | null;
  initialMine: boolean;
}) {
  const t = useTranslations('leads.recovery');
  const router = useRouter();
  const [reason, setReason] = useState<RecoveryReason | null>(initialReason);
  const [mine, setMine] = useState(initialMine);
  const q = useQuery({
    queryKey: ['recovery', { reason, mine }],
    queryFn: ({ signal }) =>
      api.leads.recovery(
        { ...(reason ? { reason } : {}), ...(mine ? { mine: '1' as const } : {}) },
        { signal },
      ),
  });
  useRealtimeLive();
  // Display clock only (time since window ended); deadlines live in Postgres.
  const [clientNow, setClientNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClientNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const skew = q.data && q.dataUpdatedAt ? Date.parse(q.data.now) - q.dataUpdatedAt : 0;
  const now = clientNow + skew;

  const pick = (r: RecoveryReason | null, m = mine) => {
    setReason(r);
    setMine(m);
    const p = new URLSearchParams();
    if (r) p.set('reason', r);
    if (m) p.set('mine', '1');
    router.replace(`/recovery${p.size ? `?${p}` : ''}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={q.data ? t('summary', { count: q.data.total }) : t('intro')}
      />
      <div role="group" aria-label={t('filters')} className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={reason === null ? 'primary' : 'secondary'}
          aria-pressed={reason === null}
          onClick={() => pick(null)}
        >
          {t('all')}
        </Button>
        {REASONS.map((r) => (
          <Button
            key={r}
            size="sm"
            variant={reason === r ? 'primary' : 'secondary'}
            aria-pressed={reason === r}
            onClick={() => pick(r)}
            data-testid={`recovery-filter-${r}`}
          >
            {t(`reason.${r}`)}
          </Button>
        ))}
        <label className="ms-2 inline-flex items-center gap-2 text-body text-fg">
          <input type="checkbox" checked={mine} onChange={(e) => pick(reason, e.target.checked)} />
          {t('mine')}
        </label>
      </div>
      {q.isError ? (
        <p role="alert" className="text-danger">
          {t('loadFailed')}
        </p>
      ) : q.isPending ? (
        <p aria-busy="true" className="text-fg-2">
          {t('loading')}
        </p>
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={PartyPopper} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="space-y-3" data-testid="recovery-list">
          {q.data.items.map((item) => (
            <RecoveryRow key={item.id} item={item} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecoveryRow({ item, now }: { item: RecoveryItem; now: number }) {
  const t = useTranslations('leads');
  const tr = useTranslations('leads.recovery');
  const [open, setOpen] = useState(false);
  return (
    <li
      className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface p-4"
      data-lead-id={item.id}
      data-reasons={item.reasons.join(' ')}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link href={`/leads/${item.id}`} className="font-medium text-fg hover:underline">
            {item.contactName}
          </Link>
          <span className="text-meta text-fg-2">{item.sourceLabel}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {item.reasons.map((r) => (
            <StatusBadge key={r} tone={TONE[r]} strong={r === 'critical'}>
              {tr(`badge.${r}`, { count: item.escalationCount })}
            </StatusBadge>
          ))}
        </div>
        <p className="text-meta text-fg-2">
          {item.windowEndedAt
            ? tr('windowEnded', { time: since(now - Date.parse(item.windowEndedAt)) })
            : tr('lastAction', { time: since(now - Date.parse(item.lastActionAt)) })}
          {' · '}
          {tr('escalations', { count: item.escalationCount })}
        </p>
      </div>
      <OwnerChip
        name={item.owner.name}
        fallback={item.custody === 'fallback'}
        fallbackReason={item.awaitingReason ? t(`awaiting.${item.awaitingReason}`) : undefined}
        compact
      />
      <div className="shrink-0">
        {item.action === 'take_over' ? (
          <TakeOverButton lead={item} />
        ) : item.action === 'reassign' ? (
          <>
            <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
              {tr('action.reassign')}
            </Button>
            <ReassignDialog lead={item} open={open} onOpenChange={setOpen} />
          </>
        ) : (
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/leads/${item.id}`}>{tr('action.open')}</Link>
          </Button>
        )}
      </div>
    </li>
  );
}
