// AlertChip (components.md §2): icon/dot + explicit label + count + chevron, 44px, links to a filtered list.
// Max 2 strong chips per header. Risk chips use warning/danger icon AND wording (DS-3).
import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Link } from '@/lib/i18n/navigation';
import { Ltr } from './ltr';

type Tone = 'neutral' | 'warning' | 'danger' | 'info';
const TONE: Record<Tone, string> = {
  neutral: 'text-fg-2',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

export function AlertChip({
  icon,
  tone = 'neutral',
  label,
  count,
  href,
  className,
  ...rest
}: {
  icon: LucideIcon;
  tone?: Tone;
  label: string;
  count: string | number;
  /** Locale-less path to the filtered list, e.g. `/leads?state=pending`. */
  href: `/${string}`;
  className?: string;
} & Omit<ComponentProps<'a'>, 'href'>) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 items-center gap-2.5 rounded-chip border border-line bg-surface px-4 text-body text-fg shadow-card',
        'transition-colors duration-(--dur-fast) hover:bg-surface-muted',
        className,
      )}
      {...rest}
    >
      <Icon icon={icon} className={cn('size-[18px]', TONE[tone])} />
      <span className="font-medium">
        <Ltr className="tabular">{count}</Ltr> <span>{label}</span>
      </span>
      <Icon icon={ChevronRight} flipInRtl className="text-fg-muted" />
    </Link>
  );
}
