'use client';
// Skeleton group: shapes the loading state like the content and exposes ONE aria-busy status (components.md §3).
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

export function SkeletonGroup({ children, className }: { children: ReactNode; className?: string }) {
  const t = useTranslations('common');
  return (
    <div aria-busy="true" className={className}>
      <span role="status" className="sr-only">
        {t('states.loading')}
      </span>
      <div className={cn('contents')}>{children}</div>
    </div>
  );
}
