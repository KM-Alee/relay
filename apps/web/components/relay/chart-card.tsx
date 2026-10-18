'use client';
// ChartCard (components.md §3): Card + question title + scope + period + unit + legend + chart + <details>
// text summary for screen readers. Charts render in a dir="ltr" island (time flows left to right in both
// locales; labels are localized). States: ready | loading | empty (reason + next action) | error (+ Retry).
import { BarChart3, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from './empty-state';
import { SkeletonGroup } from './skeleton-group';

export interface LegendItem {
  label: string;
  /** A token background class for the swatch, e.g. `bg-chart-primary`, `bg-brand`. */
  swatch: string;
}

export function ChartCard({
  title,
  scope,
  unit,
  icon,
  actions,
  legend,
  children,
  summary,
  state = 'ready',
  emptyTitle,
  emptyAction,
  onRetry,
  className,
}: {
  /** The business question the chart answers. */
  title: string;
  /** Scope + period line, e.g. "All teams · Last 30 days". */
  scope?: string;
  /** Unit shown with the axes, e.g. "PKR". */
  unit?: string;
  icon?: ReactNode;
  /** Timeframe Select, menu, etc. */
  actions?: ReactNode;
  legend?: readonly LegendItem[];
  children?: ReactNode;
  /** Accessible text summary / data table (rendered inside <details>). */
  summary?: ReactNode;
  state?: 'ready' | 'loading' | 'empty' | 'error';
  emptyTitle?: string;
  emptyAction?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('common');
  const titleId = useId();
  const description = [scope, unit].filter(Boolean).join(' · ');
  return (
    <Card className={className} role="group" aria-labelledby={titleId}>
      <CardHeader
        icon={icon ?? <BarChart3 />}
        title={title}
        titleId={titleId}
        description={description || undefined}
        actions={actions}
      />
      <div className="mt-4">
        {state === 'loading' ? (
          <SkeletonGroup className="space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </SkeletonGroup>
        ) : state === 'error' ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 py-8 text-center text-body text-danger"
          >
            <TriangleAlert aria-hidden className="size-5" />
            <span>{t('states.error')}</span>
            {onRetry ? (
              <Button variant="secondary" onClick={onRetry}>
                {t('actions.retry')}
              </Button>
            ) : null}
          </div>
        ) : state === 'empty' ? (
          <EmptyState
            headingLevel={3}
            title={emptyTitle ?? t('states.empty')}
            action={emptyAction}
            className="py-8"
          />
        ) : (
          <>
            {legend?.length ? (
              <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-meta text-fg-2">
                {legend.map((l) => (
                  <li key={l.label} className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={cn('size-2.5 rounded-chip', l.swatch)} />
                    {l.label}
                  </li>
                ))}
              </ul>
            ) : null}
            <div dir="ltr" className="min-w-0">
              {children}
            </div>
            {summary ? (
              <details className="mt-3 text-meta text-fg-2">
                <summary className="inline-flex min-h-8 cursor-pointer items-center text-brand-text">
                  {t('chart.summary')}
                </summary>
                <div className="mt-2">{summary}</div>
              </details>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
