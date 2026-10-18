// Card (components.md §3): surface, hairline border, 18px radius, whisper shadow, --card-pad padding.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-card border border-line bg-surface p-(--card-pad) shadow-card', className)}
      {...props}
    />
  );
}

/** Header: 32px icon tile + panel title (+ description) + actions at the end. */
export function CardHeader({
  icon,
  title,
  description,
  actions,
  titleId,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      {icon ? (
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-control bg-surface-muted text-fg-2 [&_svg]:size-4"
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h3 id={titleId} className="text-panel text-fg">
          {title}
        </h3>
        {description ? <p className="text-meta text-fg-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
