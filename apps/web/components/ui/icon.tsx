// Icon wrapper. Directional icons (chevrons, arrows, send, back/next) pass `flipInRtl` (docs/07 §6).
// Non-directional icons (check, clock, $) never flip. Icons are decorative by default (aria-hidden).
import type { LucideIcon, LucideProps } from 'lucide-react';
import { cn } from './cn';

export function Icon({
  icon: Glyph,
  flipInRtl,
  className,
  ...props
}: { icon: LucideIcon; flipInRtl?: boolean } & LucideProps) {
  return (
    <Glyph
      aria-hidden
      className={cn('size-4 shrink-0', flipInRtl && 'rtl:-scale-x-100', className)}
      {...props}
    />
  );
}
