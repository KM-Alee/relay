'use client';
// Lead Radar (T-201, F5.6, screens.md section 2): live mission control. Team members with availability rings,
// waiting leads as 96 px CountdownRing tokens attached to their owner, an "Awaiting handler" lane for fallback
// custody, escalation = the token glides to the next owner (Framer Motion layoutId; instant under
// prefers-reduced-motion), every token opens the lead drawer, and a text list mirrors it for screen readers.
// The UI only DISPLAYS the server deadlines: it never decides to escalate.
import type { RadarLead, RadarMember } from '@relay/contracts/api/dashboard';
import { useQuery } from '@tanstack/react-query';
import { HandHelping, Radio, TriangleAlert, Zap, CheckCheck, ChevronRight } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/relay/empty-state';
import { CountdownRing, countdownState } from '@/components/relay/countdown-ring';
import { Drawer, DrawerContent } from '@/components/relay/drawer';
import { Ltr } from '@/components/relay/ltr';
import { AVAILABILITY_META, Avatar } from '@/components/relay/owner-chip';
import { StatusBadge, type StatusTone } from '@/components/relay/status-badge';
import { api } from '@/lib/api-client';
import { formatClock } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import { qk } from '@/lib/query/keys';
import { useRealtimeLive } from '@/lib/realtime';
import { toUiAvailability } from './helpers';

const RING_TONE = {
  available: 'ring-success',
  busy: 'ring-warning',
  onLeave: 'ring-info',
  offline: 'ring-neutral',
} as const;

type TokenProps = {
  lead: RadarLead;
  offsetMs: number;
  moved: boolean;
  reduce: boolean;
  onOpen: (l: RadarLead) => void;
  custodian?: string;
};

function Token({ lead, offsetMs, moved, reduce, onOpen, custodian }: TokenProps) {
  const t = useTranslations('overview.radar');
  const c = useTranslations('common');
  const hasClock = lead.ackWindowEndsAt !== null;
  return (
    <motion.li
      layout={reduce ? false : 'position'}
      layoutId={reduce ? undefined : `lead-${lead.id}`}
      initial={reduce ? false : { opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduce ? undefined : { opacity: 0, scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="list-none"
    >
      <motion.button
        type="button"
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.97 }}
        onClick={() => onOpen(lead)}
        aria-label={t('openLead', { lead: lead.contactName, owner: lead.ownerName })}
        data-lead-token={lead.id}
        className={cn(
          'flex w-full flex-col items-center gap-1.5 rounded-card border bg-surface px-2 pb-3 pt-3 text-center transition-colors',
          'hover:bg-surface-muted',
          moved ? 'border-brand bg-brand-faint' : 'border-line',
        )}
      >
        {hasClock ? (
          <CountdownRing
            size={96}
            endsAt={lead.ackWindowEndsAt!}
            windowMs={lead.windowMs}
            serverOffsetMs={offsetMs}
            showLabel={false}
            className="flex-col gap-1"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-24 items-center justify-center rounded-chip border-4 border-line text-fg-muted"
          >
            <HandHelping className="size-7" />
          </span>
        )}
        <span className="block w-full truncate text-body font-medium text-fg">{lead.contactName}</span>
        <span className="block w-full truncate text-meta text-fg-2">{lead.sourceLabel}</span>
        <span className="flex flex-wrap items-center justify-center gap-1">
          {lead.isCritical ? (
            <StatusBadge tone="danger" strong>
              {t('critical')}
            </StatusBadge>
          ) : null}
          {lead.isUrgent ? <StatusBadge tone="warning">{t('urgent')}</StatusBadge> : null}
          {lead.escalationLevel > 0 ? (
            <StatusBadge tone="neutral">
              <Zap aria-hidden />
              {t('escalated', { level: lead.escalationLevel })}
            </StatusBadge>
          ) : null}
        </span>
        {custodian ? (
          <span className="text-meta text-fg-2">{t('custodian', { name: custodian })}</span>
        ) : null}
        <span className="sr-only">{c('actions.open')}</span>
      </motion.button>
    </motion.li>
  );
}

function MemberColumn({
  member,
  leads,
  ...tok
}: { member: Pick<RadarMember, 'userId' | 'name' | 'availability'>; leads: RadarLead[] } & Omit<
  TokenProps,
  'lead' | 'moved' | 'custodian'
> & { movedIds: ReadonlySet<string> }) {
  const t = useTranslations('overview.radar');
  const c = useTranslations('common');
  const ui = toUiAvailability(member.availability);
  const meta = AVAILABILITY_META[ui];
  return (
    <section
      aria-label={member.name}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-canvas p-3"
    >
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="relative">
          <Avatar
            name={member.name}
            className={cn('size-14 text-panel ring-4 ring-offset-2 ring-offset-canvas', RING_TONE[ui])}
          />
          <span
            aria-hidden
            className={cn(
              'absolute -bottom-1 -end-1 flex size-6 items-center justify-center rounded-chip border-2 border-canvas bg-surface',
              meta.text,
            )}
          >
            <Icon icon={meta.icon} className="size-3.5" />
          </span>
        </span>
        <span className="block w-full truncate text-body font-semibold text-fg">{member.name}</span>
        <span className={cn('flex items-center gap-1 text-meta', meta.text)}>
          <span aria-hidden className={cn('size-2 rounded-chip', meta.dot)} />
          {c(`availability.${ui}`)}
        </span>
      </div>
      <ul className="flex min-h-24 flex-col gap-2" aria-label={t('waitingCount', { count: leads.length })}>
        <AnimatePresence initial={false} mode="popLayout">
          {leads.map((l) => (
            <Token key={l.id} lead={l} moved={tok.movedIds.has(l.id)} {...tok} />
          ))}
        </AnimatePresence>
        {leads.length === 0 ? (
          <li className="flex flex-1 items-center justify-center gap-1.5 py-4 text-meta text-fg-muted">
            <Icon icon={CheckCheck} />
            {t('free')}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function LeadDrawer({
  lead,
  offsetMs,
  onClose,
}: {
  lead: RadarLead | null;
  offsetMs: number;
  onClose: () => void;
}) {
  const t = useTranslations('overview.radar');
  const tone: StatusTone = lead?.awaitingHandler ? 'warning' : 'info';
  return (
    <Drawer open={lead !== null} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent title={lead?.contactName ?? t('drawerTitle')} description={t('drawerBody')}>
        {lead ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-body">
              <dt className="text-fg-2">{t('colSource')}</dt>
              <dd className="text-fg">{lead.sourceLabel}</dd>
              <dt className="text-fg-2">{t('ownerLabel')}</dt>
              <dd className="text-fg">{lead.ownerName}</dd>
              <dt className="text-fg-2">{t('statusLabel')}</dt>
              <dd>
                <StatusBadge tone={tone}>
                  {lead.awaitingHandler ? t('awaitingTitle') : t('waitingCount', { count: 1 })}
                </StatusBadge>
              </dd>
              {lead.ackWindowEndsAt ? (
                <>
                  <dt className="text-fg-2">{t('ackWindow')}</dt>
                  <dd>
                    <CountdownRing
                      size={40}
                      endsAt={lead.ackWindowEndsAt}
                      windowMs={lead.windowMs}
                      serverOffsetMs={offsetMs}
                    />
                  </dd>
                </>
              ) : null}
            </dl>
            <Button asChild variant="primary">
              <Link href={`/leads/${lead.id}`}>
                {t('drawerOpen')}
                <Icon icon={ChevronRight} flipInRtl />
              </Link>
            </Button>
          </div>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

export function RadarView() {
  const t = useTranslations('overview.radar');
  const c = useTranslations('common');
  const reduce = useReducedMotion() ?? false;
  useRealtimeLive();

  const q = useQuery({
    queryKey: qk.radar(),
    queryFn: ({ signal }) => api.dashboard.radar({ signal }),
    // Safety net when a 'radar' hint is missed; the 1 s change feed normally refetches first.
    refetchInterval: 3000,
    placeholderData: (prev) => prev,
  });
  const data = q.data;
  const offsetMs = useMemo(
    () => (data ? Date.parse(data.now) - q.dataUpdatedAt : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- offset is recomputed per server response only
    [data?.now, q.dataUpdatedAt],
  );

  // Who moved where (escalation / reassignment): highlight + polite announcement.
  const prevOwners = useRef<Map<string, string>>(new Map());
  const [movedIds, setMovedIds] = useState<ReadonlySet<string>>(new Set());
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (!data) return;
    const moved: string[] = [];
    let msg = '';
    for (const l of data.leads) {
      const prev = prevOwners.current.get(l.id);
      if (prev && prev !== l.ownerUserId) {
        moved.push(l.id);
        msg = t('movedTo', { lead: l.contactName, owner: l.ownerName });
      }
    }
    prevOwners.current = new Map(data.leads.map((l) => [l.id, l.ownerUserId]));
    if (moved.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacts to server data changing
    setMovedIds(new Set(moved));
    setAnnounce(msg);
    const id = window.setTimeout(() => setMovedIds(new Set()), 3200);
    return () => window.clearTimeout(id);
  }, [data, t]);

  const [open, setOpen] = useState<RadarLead | null>(null);

  const { columns, awaiting, custodianNames } = useMemo(() => {
    const members: Pick<RadarMember, 'userId' | 'name' | 'availability'>[] = [...(data?.members ?? [])];
    const waiting = data?.leads ?? [];
    const aw = waiting.filter((l) => l.awaitingHandler || l.custody === 'fallback');
    const regular = waiting.filter((l) => !(l.awaitingHandler || l.custody === 'fallback'));
    for (const l of regular)
      if (!members.some((m) => m.userId === l.ownerUserId))
        members.push({ userId: l.ownerUserId, name: l.ownerName, availability: 'offline' });
    return {
      columns: members.map((m) => ({ member: m, leads: regular.filter((l) => l.ownerUserId === m.userId) })),
      awaiting: aw,
      custodianNames: new Map(aw.map((l) => [l.id, l.ownerName])),
    };
  }, [data]);

  const total = data?.leads.length ?? 0;
  const nowMs = data ? Date.parse(data.now) : 0;

  if (!data && q.isError)
    return (
      <Card role="alert" className="flex flex-wrap items-center gap-3 text-danger">
        <TriangleAlert aria-hidden className="size-5" />
        <span className="text-body">{t('errorTitle')}</span>
        <Button variant="secondary" onClick={() => void q.refetch()}>
          {c('actions.retry')}
        </Button>
      </Card>
    );

  return (
    <section aria-labelledby="radar-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="radar-title" className="text-page text-fg">
            {t('title')}
          </h2>
          <p className="text-body text-fg-2">{t('subtitle')}</p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-chip border px-3 py-1 text-meta font-medium',
            q.isError ? 'border-warning bg-warning-surface text-warning' : 'border-line bg-surface text-fg',
          )}
        >
          <span aria-hidden className="relative flex size-2.5">
            <span
              className={cn(
                'absolute inline-flex size-full rounded-chip',
                q.isError ? 'bg-warning' : 'bg-success anim-pulse',
              )}
            />
          </span>
          <Icon icon={q.isError ? TriangleAlert : Radio} />
          {q.isError ? t('paused') : t('live')}
          <span className="text-fg-2">· {t('waitingCount', { count: total })}</span>
        </span>
      </div>

      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-busy>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-card" />
          ))}
        </div>
      ) : (
        <LayoutGroup>
          <Card className="p-3 sm:p-4" role="group" aria-label={t('teamLabel')}>
            {columns.length === 0 ? (
              <EmptyState
                icon={CheckCheck}
                headingLevel={3}
                title={t('empty')}
                description={t('emptyBody')}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                {columns.map(({ member, leads }) => (
                  <MemberColumn
                    key={member.userId}
                    member={member}
                    leads={leads}
                    offsetMs={offsetMs}
                    reduce={reduce}
                    movedIds={movedIds}
                    onOpen={setOpen}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card className="border-warning" role="group" aria-labelledby="awaiting-title">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-control bg-warning-surface text-warning"
              >
                <TriangleAlert className="size-4" />
              </span>
              <div>
                <h3 id="awaiting-title" className="text-panel text-fg">
                  {t('awaitingTitle')}
                </h3>
                <p className="text-meta text-fg-2">{t('awaitingHelp')}</p>
              </div>
            </div>
            {awaiting.length === 0 ? (
              <p className="mt-3 text-body text-fg-2">{t('awaitingNone')}</p>
            ) : (
              <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <AnimatePresence initial={false} mode="popLayout">
                  {awaiting.map((l) => (
                    <Token
                      key={l.id}
                      lead={l}
                      offsetMs={offsetMs}
                      reduce={reduce}
                      moved={movedIds.has(l.id)}
                      onOpen={setOpen}
                      custodian={custodianNames.get(l.id)}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            )}
            {awaiting.some((l) => l.awaitingReason) ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {awaiting
                  .filter((l) => l.awaitingReason)
                  .map((l) => (
                    <li key={l.id}>
                      <StatusBadge tone="warning">
                        {l.contactName}: {t(`reason.${l.awaitingReason}` as 'reason.no_available')}
                      </StatusBadge>
                    </li>
                  ))}
              </ul>
            ) : null}
          </Card>

          <Card>
            <details>
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-panel text-fg">
                {t('listSummary')}
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-start text-body">
                  <caption className="sr-only">{t('listTitle')}</caption>
                  <thead>
                    <tr className="text-meta text-fg-2">
                      <th scope="col" className="py-1 pe-3 text-start font-medium">
                        {t('colLead')}
                      </th>
                      <th scope="col" className="py-1 pe-3 text-start font-medium">
                        {t('colOwner')}
                      </th>
                      <th scope="col" className="py-1 pe-3 text-start font-medium">
                        {t('colSource')}
                      </th>
                      <th scope="col" className="py-1 text-start font-medium">
                        {t('colTime')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leads.map((l) => {
                      const remaining = l.ackWindowEndsAt ? Date.parse(l.ackWindowEndsAt) - nowMs : null;
                      const st = remaining === null ? null : countdownState(remaining, l.windowMs);
                      return (
                        <tr key={l.id} className="border-t border-line">
                          <td className="py-2 pe-3 font-medium text-fg">{l.contactName}</td>
                          <td className="py-2 pe-3 text-fg-2">{l.ownerName}</td>
                          <td className="py-2 pe-3 text-fg-2">{l.sourceLabel}</td>
                          <td className="py-2 text-fg-2">
                            {remaining === null ? (
                              '–'
                            ) : st === 'overdue' ? (
                              <>
                                {c('countdown.overdue')}{' '}
                                <Ltr className="tabular">+{formatClock(Math.round(-remaining / 1000))}</Ltr>
                              </>
                            ) : (
                              <Ltr className="tabular">{formatClock(Math.round(remaining / 1000))}</Ltr>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>
        </LayoutGroup>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <LeadDrawer lead={open} offsetMs={offsetMs} onClose={() => setOpen(null)} />
    </section>
  );
}
