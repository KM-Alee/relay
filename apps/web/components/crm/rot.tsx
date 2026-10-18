'use client';
// Stage rot UI (T-221, F2.9): the red "rotting N days" badge for board cards, the human duration text, and
// the "Rotting deals" panel (the same list the recovery queue's R6 source reads: GET /opportunities/rotting).
import type { RotItem } from '@relay/contracts/api/crm-extras';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, Flame } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { StatusBadge } from '@/components/relay/status-badge';
import { cn } from '@/components/ui/cn';
import { api } from '@/lib/api-client';
import { Link } from '@/lib/i18n/navigation';
import { Money, useLoad } from './ui';

const DAY = 86_400;

/** Largest sensible unit for a duration in seconds. */
export function splitDuration(seconds: number): { unit: 'day' | 'hour' | 'minute'; n: number } {
  if (seconds >= DAY) return { unit: 'day', n: Math.floor(seconds / DAY) };
  if (seconds >= 3600) return { unit: 'hour', n: Math.floor(seconds / 3600) };
  return { unit: 'minute', n: Math.max(1, Math.floor(seconds / 60)) };
}

export function useDurationText() {
  const t = useTranslations('crm.rot');
  return (seconds: number) => {
    const { unit, n } = splitDuration(seconds);
    return t(`duration.${unit}`, { count: n });
  };
}

/** Red "Rotting 3 days" badge: text + icon + colour (Q8), never colour alone. */
export function RotBadge({ idleSeconds, className }: { idleSeconds: number; className?: string }) {
  const t = useTranslations('crm.rot');
  const text = useDurationText();
  return (
    <StatusBadge tone="danger" icon={Flame} strong className={className}>
      {t('badge', { duration: text(idleSeconds) })}
    </StatusBadge>
  );
}

/** Collapsible list of rotting deals for the current pipeline. Hidden when nothing rots. */
export function RotPanel({ pipelineId, refreshKey }: { pipelineId: string; refreshKey: string }) {
  const t = useTranslations('crm.rot');
  const text = useDurationText();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(true);
  const rot = useLoad(
    () => (pipelineId ? api.crm.rotting({ pipelineId }) : Promise.resolve({ items: [] as RotItem[] })),
    `rot:${pipelineId}:${refreshKey}`,
  );
  const items = rot.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section
      aria-labelledby="rot-title"
      className="rounded-card border border-danger bg-danger-surface p-4"
      data-testid="rot-panel"
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 text-start"
        aria-expanded={open}
        aria-controls="rot-list"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-control bg-danger text-on-danger"
        >
          <Flame className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span id="rot-title" className="block text-panel text-danger">
            {t('panelTitle', { count: items.length })}
          </span>
          <span className="block text-meta text-fg-2">{t('panelHint')}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn('size-5 text-danger transition-transform', open && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            id="rot-list"
            key="list"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className="mt-3 grid gap-2 overflow-hidden sm:grid-cols-2 xl:grid-cols-3"
          >
            {items.slice(0, 12).map((r) => (
              <li
                key={r.opportunity.id}
                className="flex min-w-0 flex-col gap-1 rounded-control border border-line bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-body font-medium text-fg">{r.opportunity.title}</p>
                  <RotBadge idleSeconds={r.idleSeconds} className="shrink-0" />
                </div>
                <p className="truncate text-meta text-fg-2">
                  <Link
                    href={`/contacts/${r.opportunity.contactId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {r.opportunity.contactName}
                  </Link>
                  {' · '}
                  {r.stageName}
                </p>
                <p className="flex items-center justify-between text-meta text-fg-muted">
                  <span>{t('rotsAfter', { duration: text(r.rotSeconds) })}</span>
                  <Money value={r.opportunity.value} />
                </p>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  );
}
