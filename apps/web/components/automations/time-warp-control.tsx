'use client';
// Time-warp control (F10.2, T-210): 1x / 10x / 60x segmented radio group. Demo workspaces only.
// Changing it proportionally reschedules pending deadlines server-side; the TopNav badge reads the same query.
import { TIME_WARP_FACTORS } from '@relay/contracts/api/automations';
import { FastForward } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { cn } from '@/components/ui/cn';
import { Ltr } from '@/components/relay/ltr';
import { useSetTimeWarp, useTimeWarp } from './use-automations';

export function TimeWarpControl({ canChange }: { canChange: boolean }) {
  const t = useTranslations('automations.timeWarp');
  const q = useTimeWarp();
  const set = useSetTimeWarp();
  const reduce = useReducedMotion();
  const gid = useId();
  if (!q.data?.demoMode) return null;
  const current = q.data.multiplier;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-meta text-fg-2">
        <FastForward aria-hidden className="size-3.5" />
        <span id={`${gid}-l`} className="font-medium">
          {t('label')}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${gid}-l`}
        className="relative inline-flex rounded-control bg-surface-muted p-1"
      >
        {TIME_WARP_FACTORS.map((f) => {
          const active = current === f;
          return (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!canChange || set.isPending}
              onClick={() => !active && set.mutate(f)}
              className={cn(
                'relative min-h-10 min-w-14 rounded-control px-3 text-button transition-colors',
                active ? 'text-fg' : 'text-fg-2 hover:text-fg',
                'disabled:cursor-not-allowed',
              )}
            >
              {active ? (
                <motion.span
                  layoutId={`${gid}-pill`}
                  aria-hidden
                  className="absolute inset-0 rounded-control bg-surface shadow-card"
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }}
                />
              ) : null}
              <Ltr className="relative tabular">{f}×</Ltr>
            </button>
          );
        })}
      </div>
      <p className="max-w-xs text-meta text-fg-2">{canChange ? t('hint') : t('noPermission')}</p>
    </div>
  );
}
