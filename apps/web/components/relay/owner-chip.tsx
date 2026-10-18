'use client';
// OwnerChip (components.md §2): avatar + name + availability (dot AND text). There is always exactly one.
// `fallback` adds the "Fallback custody" warning badge and the reason in a tooltip (F3.5).
import { Moon, Plane, UserCheck, WifiOff, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/ui/cn';
import { Tooltip } from '@/components/ui/popover';

export type Availability = 'available' | 'busy' | 'onLeave' | 'offline';

export const AVAILABILITY_META: Record<Availability, { icon: LucideIcon; dot: string; text: string }> = {
  available: { icon: UserCheck, dot: 'bg-success', text: 'text-success' },
  busy: { icon: Moon, dot: 'bg-warning', text: 'text-warning' },
  onLeave: { icon: Plane, dot: 'bg-info', text: 'text-info' },
  offline: { icon: WifiOff, dot: 'bg-neutral', text: 'text-neutral' },
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-chip bg-brand-soft text-meta font-semibold text-fg',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export function OwnerChip({
  name,
  availability,
  fallback,
  fallbackReason,
  compact,
  className,
}: {
  name: string;
  availability?: Availability;
  fallback?: boolean;
  fallbackReason?: string;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('common');
  const meta = availability ? AVAILABILITY_META[availability] : null;
  const chip = (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <span className="relative inline-flex">
        <Avatar name={name} className={compact ? 'size-6 text-[11px]' : undefined} />
        {meta ? (
          <span
            aria-hidden
            className={cn(
              'absolute -bottom-0.5 -end-0.5 size-2.5 rounded-chip border-2 border-surface',
              meta.dot,
            )}
          />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body font-medium text-fg">{name}</span>
        {meta && !compact ? (
          <span className={cn('block text-meta', meta.text)}>{t(`availability.${availability!}`)}</span>
        ) : null}
      </span>
      {meta && compact ? <span className="sr-only">{t(`availability.${availability!}`)}</span> : null}
      {fallback ? (
        <span className="inline-flex items-center gap-1 rounded-chip bg-warning-surface px-2 py-0.5 text-meta font-medium text-warning">
          <TriangleAlert aria-hidden className="size-3" />
          {t('owner.fallback')}
        </span>
      ) : null}
    </span>
  );
  return fallback && fallbackReason ? <Tooltip content={fallbackReason}>{chip}</Tooltip> : chip;
}
