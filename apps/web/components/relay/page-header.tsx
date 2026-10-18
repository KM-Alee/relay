// PageHeader (components.md §1): eyebrow · title (text-page, or text-hero on Overview) · one-sentence answer ·
// <= 2 AlertChips · optional decorative art at the END side (>= 960px only, alt-less, aria-hidden).
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { GlassArt } from './glass-art';

export function PageHeader({
  eyebrow,
  title,
  description,
  chips,
  actions,
  hero,
  art,
  headingId,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** At most two strong AlertChips. */
  chips?: ReactNode;
  actions?: ReactNode;
  /** Overview title size (text-hero). */
  hero?: boolean;
  /** Show the decorative orange glass (Overview). */
  art?: boolean;
  headingId?: string;
  className?: string;
}) {
  return (
    <header className={cn('relative isolate', hero ? 'py-6 md:py-10' : 'py-4 md:py-6', className)}>
      {art ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 end-0 -z-10 hidden w-1/2 max-w-[640px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_70%,transparent)] md:block"
        >
          <GlassArt className="h-full w-full" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? <p className="mb-2 text-eyebrow text-fg-muted">{eyebrow}</p> : null}
          <h1 id={headingId} className={cn(hero ? 'text-hero' : 'text-page', 'text-fg')}>
            {title}
          </h1>
          {description ? (
            <p className={cn('mt-2 text-fg-2', hero ? 'text-panel font-normal md:text-[19px]' : 'text-body')}>
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {chips ? <div className="mt-5 flex flex-wrap gap-3">{chips}</div> : null}
    </header>
  );
}
