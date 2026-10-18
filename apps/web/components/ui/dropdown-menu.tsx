'use client';
// Dropdown menu (Radix). Used by MoreMenu, user menu, theme + availability pickers.
import { Check } from 'lucide-react';
import { DropdownMenu as M } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuRadioGroup = M.RadioGroup;
export const DropdownMenuGroup = M.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          'anim-pop z-popover min-w-56 max-w-[calc(100vw-1.5rem)] rounded-card border border-line bg-surface p-1.5 text-fg shadow-pop',
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

const itemBase =
  'relative flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-control px-3 text-body outline-none sm:min-h-10 ' +
  'data-[highlighted]:bg-surface-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof M.Item>) {
  return <M.Item className={cn(itemBase, className)} {...props} />;
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(itemBase, 'pe-9 data-[state=checked]:bg-brand-soft', className)} {...props}>
      {children}
      <M.ItemIndicator className="absolute end-3">
        <Check aria-hidden className="size-4" />
      </M.ItemIndicator>
    </M.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('px-3 py-1.5 text-meta text-fg-muted', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn('-mx-1.5 my-1.5 h-px bg-line', className)} {...props} />;
}
