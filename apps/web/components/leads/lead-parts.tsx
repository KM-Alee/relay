'use client';
// Lead building blocks (Lane A): state badge, owner + custody, countdown, acknowledge, trace sentence.
// Tokens + shared components only (docs/design); strings from next-intl `leads.*`.
import type { LeadState, LeadSummary } from '@relay/contracts/api/leads';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CountdownRing } from '@/components/relay/countdown-ring';
import { OwnerChip } from '@/components/relay/owner-chip';
import { StatusBadge, type StatusTone } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';

const TONE: Record<LeadState, StatusTone> = {
  awaitingHandler: 'warning',
  assignedPending: 'info',
  overdue: 'danger',
  critical: 'danger',
  acknowledged: 'success',
  idle: 'neutral',
  closed: 'neutral',
};

export function LeadStateBadge({ state }: { state: LeadState }) {
  const t = useTranslations('leads');
  return (
    <StatusBadge tone={TONE[state]} strong={state === 'critical'}>
      {t(`state.${state}`)}
    </StatusBadge>
  );
}

export function LeadOwner({ lead }: { lead: LeadSummary }) {
  const t = useTranslations('leads');
  return (
    <OwnerChip
      name={lead.owner.name}
      fallback={lead.custody === 'fallback'}
      fallbackReason={lead.awaitingReason ? t(`awaiting.${lead.awaitingReason}`) : undefined}
      compact
    />
  );
}

export function LeadCountdown({ lead, size = 40 }: { lead: LeadSummary; size?: 20 | 40 | 96 }) {
  if (lead.status !== 'open' || lead.ackStatus !== 'pending' || !lead.ackWindowEndsAt) return null;
  const windowMs = Math.max(1000, Date.parse(lead.ackWindowEndsAt) - Date.parse(lead.assignedAt));
  return <CountdownRing endsAt={lead.ackWindowEndsAt} windowMs={windowMs} size={size} />;
}

export function AcknowledgeButton({ lead }: { lead: LeadSummary }) {
  const t = useTranslations('leads');
  const qc = useQueryClient();
  const ack = useMutation({
    mutationFn: () => api.leads.acknowledge(lead.id, lead.version),
    onSuccess: () => toast.success(t('detail.acked')),
    onError: () => toast.error(t('detail.stale')),
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
  if (!lead.canAcknowledge) return null;
  return (
    <Button variant="primary" size="sm" disabled={ack.isPending} onClick={() => ack.mutate()}>
      {t('detail.ackButton')}
    </Button>
  );
}

interface TraceEntryLike {
  outcome: 'skipped' | 'chosen' | 'broadcast' | 'fallback';
  name: string | null;
  reason: string;
  openCount?: number;
  capacity?: number;
}

/** "Skipped Ali (on leave); assigned Hamza (round-robin, next in rotation)" (F3.11). */
export function useTraceSentence() {
  const t = useTranslations('leads.trace');
  const r = (k: string) => (t.has(`reason.${k}`) ? t(`reason.${k}`) : k);
  return (trace: readonly TraceEntryLike[] | null): string =>
    (trace ?? [])
      .map((e) => {
        const name = e.name ?? '?';
        if (e.outcome === 'skipped')
          return e.reason === 'at_capacity' && e.capacity !== undefined
            ? t('skippedCapacity', { name, open: e.openCount ?? 0, capacity: e.capacity })
            : t('skipped', { name, reason: r(e.reason) });
        if (e.outcome === 'chosen') return t('chosen', { name, reason: r(e.reason) });
        if (e.outcome === 'broadcast') return t('broadcast', { name });
        return t('fallback', { name });
      })
      .join('; ');
}
