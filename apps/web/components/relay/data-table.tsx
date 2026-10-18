'use client';
// DataTable (components.md §3): sticky header, sortable columns (aria-sort), row hover, keyboard row focus.
// Below `sm` it becomes SUMMARY CARDS with an explicit "Details" affordance (guide §08).
// Cursor pagination is the caller's job: pass `footer` (e.g. a "Load more" button).
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonGroup } from './skeleton-group';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'start' | 'end';
  /** Phone cards: `title` = card heading (one column), `meta` = label/value pair (default), `hide`. */
  mobile?: 'title' | 'meta' | 'hide';
  className?: string;
}

export interface SortState {
  id: string;
  dir: 'asc' | 'desc';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  onSortChange,
  onRowOpen,
  loading,
  empty,
  footer,
  className,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Visually hidden table caption (names the table for screen readers). */
  caption: string;
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
  /** Row click / Enter / the phone "Details" button. */
  onRowOpen?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('common');
  const titleCol = columns.find((c) => c.mobile === 'title') ?? columns[0];
  const metaCols = columns.filter((c) => c !== titleCol && c.mobile !== 'hide');

  if (loading)
    return (
      <SkeletonGroup className={cn('space-y-2', className)}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </SkeletonGroup>
    );
  if (rows.length === 0 && empty) return <div className={className}>{empty}</div>;

  const toggle = (c: Column<T>) => {
    if (!c.sortable || !onSortChange) return;
    onSortChange({ id: c.id, dir: sort?.id === c.id && sort.dir === 'asc' ? 'desc' : 'asc' });
  };
  const onKey = (e: KeyboardEvent, row: T) => {
    if (onRowOpen && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      onRowOpen(row);
    }
  };

  return (
    <div className={className}>
      {/* >= sm: table */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface sm:block">
        <table className="w-full border-collapse text-start text-body">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.id === c.id;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={
                      c.sortable
                        ? active
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                        : undefined
                    }
                    className={cn(
                      'sticky top-0 border-b border-line bg-surface-muted px-4 py-3 text-meta font-semibold text-fg-2',
                      c.align === 'end' ? 'text-end' : 'text-start',
                      c.className,
                    )}
                  >
                    {c.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggle(c)}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-control text-fg hover:text-brand-text"
                      >
                        {c.header}
                        <Icon
                          icon={active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown}
                          className="size-3.5"
                        />
                        <span className="sr-only">{t('table.sort')}</span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                tabIndex={onRowOpen ? 0 : undefined}
                onClick={onRowOpen ? () => onRowOpen(row) : undefined}
                onKeyDown={onRowOpen ? (e) => onKey(e, row) : undefined}
                className={cn(
                  'border-b border-line last:border-b-0 hover:bg-surface-muted',
                  onRowOpen && 'cursor-pointer focus-visible:-outline-offset-2',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      'px-4 py-3 align-middle',
                      c.align === 'end' ? 'text-end' : 'text-start',
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* < sm: summary cards */}
      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-card border border-line bg-surface p-4 shadow-card">
            {titleCol ? <div className="text-body font-semibold text-fg">{titleCol.cell(row)}</div> : null}
            <dl className="mt-2 space-y-1.5">
              {metaCols.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3">
                  <dt className="text-meta text-fg-muted">{c.header}</dt>
                  <dd className="min-w-0 text-body text-fg">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {onRowOpen ? (
              <button
                type="button"
                onClick={() => onRowOpen(row)}
                className="mt-3 inline-flex min-h-11 items-center gap-1 text-button text-brand-text"
              >
                {t('actions.details')}
                <Icon icon={ChevronRight} flipInRtl />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {footer ? <div className="mt-3 flex justify-center">{footer}</div> : null}
    </div>
  );
}
