'use client';
// TimeWarpBadge (components.md §1, F10.2): persistent chip when time-warp != 1. Renders nothing at 1x.
import { FastForward } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/ui/cn';
import { Ltr } from './ltr';

export function TimeWarpBadge({
  factor,
  compact,
  onClick,
  className,
}: {
  factor: number;
  compact?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const t = useTranslations('common');
  if (!factor || factor === 1) return null;
  const body = (
    <>
      <FastForward aria-hidden className="size-3.5 shrink-0" />
      <Ltr className="tabular">{factor}×</Ltr>
      {compact ? <span className="sr-only">{t('timeWarp.label')}</span> : <span>{t('timeWarp.label')}</span>}
    </>
  );
  const cls = cn(
    'inline-flex items-center gap-1.5 rounded-chip bg-info-surface px-2.5 py-0.5 text-meta font-semibold text-info',
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'min-h-8')}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}
