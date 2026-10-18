import type { ComponentProps } from 'react';
import { cn } from './cn';

/** Decorative block. Wrap a group in <SkeletonGroup> (relay) to expose one aria-busy status. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div aria-hidden data-slot="skeleton" className={cn('skeleton rounded-control', className)} {...props} />
  );
}
