'use client';
// KpiTile (components.md §3): icon + label · big tabular number · delta (arrow + INTERPRETED colour) ·
// comparison label · sparkline. A link only when it opens the filtered list (F5.3).
// States: ready | loading | empty | error. Delta tone is semantic (lower response time = good), never raw sign.
import { ArrowDown, ArrowUp, Minus, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/lib/i18n/navigation';
import { Ltr } from './ltr';
import { SkeletonGroup } from './skeleton-group';
import { Sparkline } from './sparkline';

export interface KpiDelta {
  /** Display text, already formatted (e.g. "8%"); the sign is shown by the arrow + sr text. */
  text: string;
  direction: 'up' | 'down' | 'flat';
  /** Interpretation, not sign: good = success, bad = danger, neutral = muted. */
  tone: 'good' | 'bad' | 'neutral';
}

const TONE = { good: 'text-success', bad: 'text-danger', neutral: 'text-fg-2' } as const;

export function KpiTile({
  icon,
  label,
  value,
  delta,
  compareLabel,
  spark,
  href,
  state = 'ready',
  emptyText,
  onRetry,
  className,
}: {
  /** An element, e.g. `<UserPlus />` (elements, not component refs, so Server Components can pass it). */
  icon: ReactNode;
  label: string;
  /** Pre-formatted value (use useFormat / <MaskedValue/> for money). */
  value?: ReactNode;
  delta?: KpiDelta;
  compareLabel?: string;
  spark?: readonly number[];
  /** Locale-less path to the filtered list. Omit when the tile doesn't drill down. */
  href?: `/${string}`;
  state?: 'ready' | 'loading' | 'empty' | 'error';
  emptyText?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('common');
  const body =
    state === 'loading' ? (
      <SkeletonGroup className="mt-5 space-y-3">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-4 w-36" />
      </SkeletonGroup>
    ) : state === 'error' ? (
      <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-body text-danger">
        <TriangleAlert aria-hidden className="size-4" />
        <span>{t('states.error')}</span>
        {onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t('actions.retry')}
          </Button>
        ) : null}
      </div>
    ) : state === 'empty' ? (
      <p className="mt-auto pt-5 text-body text-fg-2">{emptyText ?? t('states.empty')}</p>
    ) : (
      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-kpi text-fg">{value}</span>
            {delta ? (
              <span
                className={cn('inline-flex items-center gap-1 text-body font-semibold', TONE[delta.tone])}
              >
                <Icon
                  icon={delta.direction === 'up' ? ArrowUp : delta.direction === 'down' ? ArrowDown : Minus}
                />
                <Ltr className="tabular">{delta.text}</Ltr>
                <span className="sr-only">{t(`delta.${delta.direction}`)}</span>
              </span>
            ) : null}
          </div>
          {compareLabel ? <p className="mt-1 text-meta text-fg-muted">{compareLabel}</p> : null}
        </div>
        {/* reserve the sparkline slot so tiles in a row share one internal layout */}
        {spark ? <Sparkline data={spark} /> : <span aria-hidden className="h-10 w-28 shrink-0" />}
      </div>
    );

  const inner = (
    <>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-control bg-surface-muted text-fg-2"
        >
          {icon}
        </span>
        <span className="text-body text-fg-2">{label}</span>
      </div>
      {body}
    </>
  );

  if (href && state === 'ready') {
    return (
      <Link
        href={href}
        className={cn(
          'flex flex-col rounded-card border border-line bg-surface p-(--card-pad) shadow-card transition-colors duration-(--dur-fast) hover:bg-surface-muted',
          className,
        )}
      >
        {inner}
      </Link>
    );
  }
  return <Card className={cn('flex flex-col', className)}>{inner}</Card>;
}
