'use client';
// Select (Radix): the timeframe pickers etc. Looks like Input; the listbox uses the popover surface.
import { Check, ChevronDown } from 'lucide-react';
import { Select as S } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { fieldClass } from './input';

export const Select = S.Root;
export const SelectValue = S.Value;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof S.Trigger>) {
  return (
    <S.Trigger
      className={cn(fieldClass, 'flex h-11 items-center justify-between gap-2 text-start sm:h-10', className)}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <S.Icon asChild>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-2" />
      </S.Icon>
    </S.Trigger>
  );
}

export function SelectContent({ className, children, ...props }: ComponentProps<typeof S.Content>) {
  return (
    <S.Portal>
      <S.Content
        position="popper"
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          'anim-pop z-popover max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden rounded-card border border-line bg-surface p-1.5 text-fg shadow-pop',
          className,
        )}
        {...props}
      >
        <S.Viewport>{children}</S.Viewport>
      </S.Content>
    </S.Portal>
  );
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof S.Item>) {
  return (
    <S.Item
      className={cn(
        'relative flex min-h-11 cursor-pointer select-none items-center rounded-control ps-3 pe-9 text-body outline-none sm:min-h-10',
        'data-[highlighted]:bg-surface-muted data-[state=checked]:bg-brand-soft',
        className,
      )}
      {...props}
    >
      <S.ItemText>{children}</S.ItemText>
      <S.ItemIndicator className="absolute end-3">
        <Check aria-hidden className="size-4" />
      </S.ItemIndicator>
    </S.Item>
  );
}
