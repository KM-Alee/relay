'use client';
// Tabs: in-page secondary navigation only (never global nav). Selected = brand-soft capsule + weight.
import { Tabs as T } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const Tabs = T.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn(
        'inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-control bg-surface-muted p-1',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-control px-4 text-button text-fg-2 transition-colors',
        'hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cn('mt-4', className)} {...props} />;
}
