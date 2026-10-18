'use client';
// NotificationsBell + Panel shell (components.md §1, F3.4). Count badge shows the NUMBER (not just a dot).
// Pending acknowledgements and escalations come first, each with a countdown/owner and an Open action.
// Data arrives via `items` (api.notifications lands with Lane A, T-123); live region is polite.
import { Bell, BellOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Link } from '@/lib/i18n/navigation';
import { useFormat } from '@/lib/format/use-format';
import { CountdownRing } from './countdown-ring';
import { EmptyState } from './empty-state';
import { OwnerChip } from './owner-chip';
import { StatusBadge } from './status-badge';

export interface NotificationItem {
  id: string;
  kind: 'ack' | 'escalation' | 'info';
  title: string;
  ownerName?: string;
  /** Present for kind=ack: the server deadline. */
  endsAt?: string;
  windowMs?: number;
  href: `/${string}`;
}

export function NotificationsPanel({
  items = [],
  serverOffsetMs,
  nowMs,
}: {
  items?: readonly NotificationItem[];
  serverOffsetMs?: number;
  nowMs?: number;
}) {
  const t = useTranslations('common');
  const f = useFormat();
  const count = items.length;
  const ordered = [...items].sort((a, b) => rank(a.kind) - rank(b.kind));
  return (
    <Popover>
      <PopoverTrigger
        className="relative inline-flex size-11 items-center justify-center rounded-control text-fg-2 transition-colors hover:bg-surface-muted hover:text-fg"
        aria-label={t('shell.notifications.openLabel', { count })}
      >
        <Bell aria-hidden className="size-5" />
        {count > 0 ? (
          <span
            aria-hidden
            className="absolute -end-0.5 -top-0.5 inline-flex min-w-5 items-center justify-center rounded-chip bg-brand-strong px-1 text-[11px] font-bold leading-5 text-on-brand-strong"
          >
            {f.number(count)}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] p-0">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-panel text-fg">{t('shell.notifications.title')}</h2>
        </div>
        <div aria-live="polite" className="max-h-[60dvh] overflow-y-auto">
          {count === 0 ? (
            <EmptyState
              icon={BellOff}
              headingLevel={3}
              title={t('shell.notifications.emptyTitle')}
              description={t('shell.notifications.emptyBody')}
              className="py-10"
            />
          ) : (
            <ul className="divide-y divide-line">
              {ordered.map((n) => (
                <li key={n.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={n.kind === 'escalation' ? 'danger' : n.kind === 'ack' ? 'warning' : 'info'}
                      >
                        {t(`shell.notifications.kind.${n.kind}`)}
                      </StatusBadge>
                    </div>
                    <p className="text-body font-medium text-fg">{n.title}</p>
                    {n.ownerName ? <OwnerChip name={n.ownerName} compact /> : null}
                    {n.endsAt && n.windowMs ? (
                      <CountdownRing
                        endsAt={n.endsAt}
                        windowMs={n.windowMs}
                        size={20}
                        serverOffsetMs={serverOffsetMs}
                        nowMs={nowMs}
                      />
                    ) : null}
                  </div>
                  <Button asChild size="sm" variant={n.kind === 'ack' ? 'primary' : 'secondary'}>
                    <Link href={n.href}>
                      {n.kind === 'ack' ? t('actions.acknowledge') : t('actions.open')}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const rank = (k: NotificationItem['kind']) => (k === 'escalation' ? 0 : k === 'ack' ? 1 : 2);
