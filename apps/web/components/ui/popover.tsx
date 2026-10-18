'use client';
// Popover + Tooltip (Radix). Tooltips open on hover AND keyboard focus (guide §06); never the only carrier of info.
import { Popover as P, Tooltip as T } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({ className, sideOffset = 10, ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'anim-pop z-popover w-96 max-w-[calc(100vw-1.5rem)] rounded-card border border-line bg-surface p-4 text-fg shadow-pop',
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          sideOffset={6}
          collisionPadding={12}
          className="anim-fade z-popover max-w-64 rounded-control bg-fg px-3 py-2 text-meta text-surface shadow-pop"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
