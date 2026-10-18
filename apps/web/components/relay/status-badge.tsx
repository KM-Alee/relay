// StatusBadge (components.md §2): semantic colour + icon + label, always all three (Q8).
// Lead-state mapping: Awaiting handler = warning · Assigned/pending = info · Overdue/Critical = danger ·
// Acknowledged = success · Idle/Closed = neutral. Brand orange NEVER means warning (DS-3).
import { cva, type VariantProps } from 'class-variance-authority';
import { CircleCheck, Clock3, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

const badge = cva(
  'inline-flex max-w-full items-center gap-1.5 rounded-chip px-2.5 py-0.5 text-meta font-medium [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        success: 'bg-success-surface text-success',
        warning: 'bg-warning-surface text-warning',
        danger: 'bg-danger-surface text-danger',
        info: 'bg-info-surface text-info',
        neutral: 'bg-neutral-surface text-neutral',
        disabled: 'bg-neutral-surface text-fg-muted',
      },
      strong: { true: 'font-bold', false: '' },
    },
    defaultVariants: { tone: 'neutral', strong: false },
  },
);

const ICONS: Record<NonNullable<VariantProps<typeof badge>['tone']>, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
  info: Info,
  neutral: Clock3,
  disabled: Clock3,
};

export type StatusTone = NonNullable<VariantProps<typeof badge>['tone']>;

export function StatusBadge({
  tone = 'neutral',
  strong,
  icon,
  children,
  className,
}: {
  tone?: StatusTone;
  strong?: boolean;
  /** Override the default icon for the tone (e.g. a lock for "Hidden"). */
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  const Glyph = icon ?? ICONS[tone];
  return (
    <span className={cn(badge({ tone, strong }), className)} data-tone={tone}>
      <Glyph aria-hidden />
      <span className="min-w-0">{children}</span>
    </span>
  );
}
