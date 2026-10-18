// EmptyState (components.md §3): short reason + scope + ONE primary next action. Also the "coming soon" look.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

export function EmptyState({
  icon: Glyph,
  title,
  description,
  action,
  headingLevel = 2,
  className,
  ...rest
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  className?: string;
  'data-testid'?: string;
}) {
  const H = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
  return (
    <div
      className={cn('mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-12 text-center', className)}
      {...rest}
    >
      {Glyph ? (
        <span
          aria-hidden
          className="flex size-14 items-center justify-center rounded-card bg-brand-faint text-brand-text"
        >
          <Glyph className="size-6" />
        </span>
      ) : null}
      <H className="text-panel text-fg">{title}</H>
      {description ? <p className="text-body text-fg-2">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
