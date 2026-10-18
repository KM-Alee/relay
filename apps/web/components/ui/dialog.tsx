'use client';
// Dialog + Sheet/Drawer (components.md §5). Focus trap, Escape closes, labelled by title (Radix).
// Drawer = record preview at the END side (480px, full width on phones).
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog as D } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

function Overlay({ className }: { className?: string }) {
  return (
    <D.Overlay
      data-relay-overlay
      className={cn('fixed inset-0 bg-fg/40 backdrop-blur-[2px]', className ?? 'z-modal')}
    />
  );
}

function CloseButton() {
  const t = useTranslations('common');
  return (
    <D.Close
      className="absolute end-3 top-3 inline-flex size-11 items-center justify-center rounded-control text-fg-2 transition-colors hover:bg-surface-muted hover:text-fg sm:size-9"
      aria-label={t('actions.close')}
    >
      <X aria-hidden className="size-4" />
    </D.Close>
  );
}

export function DialogContent({
  title,
  description,
  children,
  className,
  hideTitle,
  ...props
}: {
  title: ReactNode;
  description?: ReactNode;
  hideTitle?: boolean;
} & Omit<ComponentProps<typeof D.Content>, 'title'>) {
  return (
    <D.Portal>
      <Overlay />
      <D.Content
        className={cn(
          'anim-pop fixed start-1/2 top-1/2 z-modal max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
          'rounded-card border border-line bg-surface p-6 shadow-pop rtl:translate-x-1/2',
          className,
        )}
        {...props}
      >
        <D.Title className={cn('text-panel pe-10 text-fg', hideTitle && 'sr-only')}>{title}</D.Title>
        {description ? (
          <D.Description className="mt-1 text-body text-fg-2">{description}</D.Description>
        ) : (
          <D.Description className="sr-only">{title}</D.Description>
        )}
        <div className="mt-4">{children}</div>
        <CloseButton />
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-6 flex flex-wrap justify-end gap-2', className)} {...props} />;
}

/* ---- Sheet / Drawer ---- */
export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

export function SheetContent({
  title,
  description,
  children,
  side = 'end',
  className,
  ...props
}: {
  title: ReactNode;
  description?: ReactNode;
  side?: 'end' | 'start';
} & Omit<ComponentProps<typeof D.Content>, 'title'>) {
  return (
    <D.Portal>
      <Overlay className="z-drawer" />
      <D.Content
        className={cn(
          'anim-slide-end fixed inset-y-0 z-drawer flex w-full max-w-[480px] flex-col overflow-y-auto bg-surface p-6 shadow-pop',
          side === 'end'
            ? 'end-0 border-s border-line'
            : 'start-0 border-e border-line [--slide-from:-24px] rtl:[--slide-from:24px]',
          className,
        )}
        {...props}
      >
        <D.Title className="text-panel pe-10 text-fg">{title}</D.Title>
        {description ? (
          <D.Description className="mt-1 text-body text-fg-2">{description}</D.Description>
        ) : (
          <D.Description className="sr-only">{title}</D.Description>
        )}
        <div className="mt-4 flex-1">{children}</div>
        <CloseButton />
      </D.Content>
    </D.Portal>
  );
}
