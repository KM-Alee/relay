'use client';
// Lead interventions (Lane A): manual reassign with eligibility + override reason (03 T7, OQ-2), Take over
// (03 §11 Q3), the absent-owner banner (F3.6) and the AI handoff brief (F6.10). Tokens + shared components.
import type { LeadDetail } from '@relay/contracts/api/leads';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AIBadge } from '@/components/relay/ai-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { fieldClass } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';
import { localizeError } from '@/lib/http/client-error';

type Target = { id: string; contactName: string; version?: number };

export function ReassignDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: Target;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('leads.reassign');
  const tr = useTranslations('leads.trace.reason');
  const te = useTranslations();
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const targets = useQuery({
    queryKey: ['leads', 'reassign-targets', lead.id],
    queryFn: ({ signal }) => api.leads.reassignTargets(lead.id, { signal }),
    enabled: open,
  });
  const picked = targets.data?.items.find((x) => x.userId === to);
  const needsOverride = !!picked && !picked.eligible;
  const m = useMutation({
    mutationFn: () =>
      api.leads.reassign(lead.id, {
        toUserId: to,
        ...(needsOverride ? { override: true, overrideReason: reason.trim() } : {}),
        version: lead.version,
      }),
    onSuccess: () => {
      toast.success(t('done', { name: picked?.name ?? '' }));
      onOpenChange(false);
      setTo('');
      setReason('');
    },
    onError: (e) => toast.error(localizeError(e, (k, v) => te(k, v))),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['recovery'] });
    },
  });
  const canSubmit = !!to && !picked?.isCurrentOwner && (!needsOverride || reason.trim().length > 2);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('title', { name: lead.contactName })} description={t('description')}>
        <label className="block text-meta text-fg-2">
          {t('target')}
          <select
            className={`${fieldClass} mt-1 h-11`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-busy={targets.isPending}
            data-testid="reassign-target"
          >
            <option value="">{t('pick')}</option>
            {(targets.data?.items ?? []).map((x) => (
              <option key={x.userId} value={x.userId} disabled={x.isCurrentOwner}>
                {x.eligible
                  ? t('eligibleOption', { name: x.name, open: x.openLeads, capacity: x.capacity })
                  : t('ineligibleOption', {
                      name: x.name,
                      reason: x.ineligibleReason && tr.has(x.ineligibleReason) ? tr(x.ineligibleReason) : '',
                    })}
              </option>
            ))}
          </select>
        </label>
        {needsOverride ? (
          <label className="mt-3 block text-meta text-fg-2">
            {t('overrideReason')}
            <textarea
              className={`${fieldClass} mt-1`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              required
              data-testid="reassign-override-reason"
            />
            <span className="mt-1 block text-fg-muted">{t('overrideHint')}</span>
          </label>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t('cancel')}</Button>
          </DialogClose>
          <Button variant="primary" loading={m.isPending} disabled={!canSubmit} onClick={() => m.mutate()}>
            {needsOverride ? t('submitOverride') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TakeOverButton({ lead, size = 'sm' }: { lead: { id: string }; size?: 'sm' | 'md' }) {
  const t = useTranslations('leads.reassign');
  const te = useTranslations();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.leads.takeOver(lead.id),
    onSuccess: () => toast.success(t('tookOver')),
    onError: (e) => toast.error(localizeError(e, (k, v) => te(k, v))),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      void qc.invalidateQueries({ queryKey: ['recovery'] });
    },
  });
  return (
    <Button variant="primary" size={size} loading={m.isPending} onClick={() => m.mutate()}>
      {t('takeOver')}
    </Button>
  );
}

export function LeadInterventions({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('leads.reassign');
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {lead.canTakeOver ? <TakeOverButton lead={lead} /> : null}
      {lead.canReassign ? (
        <>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {t('open')}
          </Button>
          <ReassignDialog lead={lead} open={open} onOpenChange={setOpen} />
        </>
      ) : null}
    </div>
  );
}

/** F3.6 P0: an acknowledged lead of an absent owner stays with them; the banner says which rule applies. */
export function AbsentOwnerBanner({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('leads.banner');
  const absent = lead.ownerAvailability === 'on_leave' || lead.ownerAvailability === 'offline';
  if (lead.status !== 'open' || lead.ackStatus !== 'acknowledged' || !absent) return null;
  return (
    <div
      role="status"
      className="flex gap-3 rounded-card border border-line bg-warning-surface p-4 text-body text-fg"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      <div>
        <p className="font-medium">
          {t('ownerAbsentTitle', {
            name: lead.owner.name,
            status: t(`availability.${lead.ownerAvailability}`),
          })}
        </p>
        <p className="text-fg-2">{t('ownerAbsentRule')}</p>
      </div>
    </div>
  );
}

export function AiBriefCard({ lead }: { lead: LeadDetail }) {
  const t = useTranslations('leads.ai');
  if (!lead.aiBrief && !lead.aiActive) return null;
  return (
    <section className="rounded-card border border-line bg-surface p-4" data-testid="ai-brief">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <AIBadge />
        <h2 className="font-medium text-fg">{lead.aiActive ? t('activeTitle') : t('briefTitle')}</h2>
      </div>
      {lead.aiActive ? <p className="mb-2 text-meta text-fg-2">{t('activeHint')}</p> : null}
      {lead.aiBrief ? (
        <dl className="grid gap-1 text-body">
          <div>
            <dt className="inline text-fg-2">{t('goal')}: </dt>
            <dd className="inline text-fg">{lead.aiBrief.goal}</dd>
          </div>
          <div>
            <dt className="inline text-fg-2">{t('mood')}: </dt>
            <dd className="inline text-fg">{lead.aiBrief.mood}</dd>
          </div>
          {lead.aiBrief.summary ? (
            <div>
              <dt className="inline text-fg-2">{t('summary')}: </dt>
              <dd className="inline text-fg">{lead.aiBrief.summary}</dd>
            </div>
          ) : null}
          {lead.aiBrief.suggestedReply ? (
            <div>
              <dt className="inline text-fg-2">{t('suggested')}: </dt>
              <dd className="inline text-fg">{lead.aiBrief.suggestedReply}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
