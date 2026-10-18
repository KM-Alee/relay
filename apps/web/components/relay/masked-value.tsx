'use client';
// MaskedValue (F1.4, docs/07 §3): renders the server's `{ masked: true }` state. Never `0`, never blank.
// The server already masked the value: this component only renders that fact.
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Tooltip } from '@/components/ui/popover';
import { cn } from '@/components/ui/cn';

export function MaskedValue({ className }: { className?: string }) {
  const t = useTranslations('common');
  return (
    <Tooltip content={t('mask.tooltip')}>
      <span
        tabIndex={0}
        className={cn('inline-flex items-center gap-1.5 rounded-control text-fg-2', className)}
      >
        <Lock aria-hidden className="size-3.5 shrink-0" />
        <span>{t('mask.hidden')}</span>
        <span className="sr-only">{t('mask.tooltip')}</span>
      </span>
    </Tooltip>
  );
}
