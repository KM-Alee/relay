'use client';
// Shared-layout highlight (nav capsule, segmented tabs, selected rows). Render it INSIDE the active item only;
// motion slides it between items with the same `layoutId`. Decorative (aria-hidden): the active state must also
// be expressed by aria-current / aria-selected / text weight (Q8). Reduced motion: it jumps instead of sliding.
import { motion } from 'motion/react';
import { cn } from '@/components/ui/cn';
import { useMotionOff } from './primitives';
import { SPRING } from './tokens';

export function Highlight({ layoutId, className }: { layoutId: string; className?: string }) {
  const off = useMotionOff();
  return (
    <motion.span
      aria-hidden
      layoutId={off ? undefined : layoutId}
      transition={SPRING.layout}
      className={cn('absolute inset-0 -z-10', className)}
    />
  );
}
