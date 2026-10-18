'use client';
// Command palette primitives (cmdk). Used by SearchCommand (⌘K).
import { Command as C } from 'cmdk';
import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export function CommandDialog({
  label,
  children,
  ...props
}: Omit<ComponentProps<typeof C.Dialog>, 'label'> & { label: string }) {
  return (
    <C.Dialog
      label={label}
      overlayClassName="fixed inset-0 z-modal bg-fg/40 backdrop-blur-[2px]"
      contentClassName="anim-pop fixed start-1/2 top-[12dvh] z-modal w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card border border-line bg-surface shadow-pop rtl:translate-x-1/2"
      {...props}
    >
      {children}
    </C.Dialog>
  );
}

export function CommandInput({ className, ...props }: ComponentProps<typeof C.Input>) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4">
      <Search aria-hidden className="size-4 shrink-0 text-fg-muted" />
      <C.Input
        className={cn(
          'h-14 w-full bg-transparent text-body text-fg outline-none placeholder:text-fg-muted focus-visible:shadow-none focus-visible:outline-none',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof C.List>) {
  return <C.List className={cn('max-h-[50dvh] overflow-y-auto p-2', className)} {...props} />;
}

export function CommandEmpty({ className, ...props }: ComponentProps<typeof C.Empty>) {
  return <C.Empty className={cn('px-4 py-8 text-center text-body text-fg-2', className)} {...props} />;
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof C.Group>) {
  return (
    <C.Group
      className={cn(
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof C.Item>) {
  return (
    <C.Item
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-3 text-body text-fg',
        'data-[selected=true]:bg-brand-soft [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export const Command = C;
