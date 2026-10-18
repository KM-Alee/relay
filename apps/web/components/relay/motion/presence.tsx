'use client';
// Presence helpers + route transition (Q17). All reduced-motion aware.
//
//   <PageTransition>{children}</PageTransition>     AppShell: subtle fade/rise on route change (<= 150 ms fade)
//   <Presence><PresenceFade key={id}>…</PresenceFade></Presence>   mount/unmount fades
//   <Collapse open={open}>…</Collapse>              height auto open/close (forms, details)
//   <PopIn key={id}>…</PopIn>                        new list items / bubbles / badges
import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';
import { usePathname } from '@/lib/i18n/navigation';
import { useDirX, useMotionOff } from './primitives';
import { DUR, EASE, SPRING, T } from './tokens';

/** Re-export so lanes import presence from one place. `initial={false}` skips first-render animations. */
export { AnimatePresence as Presence, LayoutGroup } from 'motion/react';

type DivProps = Omit<HTMLMotionProps<'div'>, 'children'> & { children?: ReactNode };

/** Route-level enter: opacity + 4 px rise, keyed by pathname. No exit (App Router swaps instantly). */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const pathname = usePathname();
  const off = useMotionOff();
  return (
    <motion.div
      key={pathname}
      className={className}
      initial={off ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ opacity: T.fade, y: { duration: DUR.slow, ease: EASE.standard } }}
    >
      {children}
    </motion.div>
  );
}

export function PresenceFade({ children, ...rest }: DivProps) {
  const off = useMotionOff();
  return (
    <motion.div
      initial={off ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={off ? undefined : { opacity: 0, transition: T.exit }}
      transition={T.fade}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Height-auto disclosure. Content stays mounted only while open (unmounts after the close animation). */
export function Collapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const off = useMotionOff();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="collapse"
          className={className}
          style={{ overflow: 'hidden' }}
          initial={off ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={off ? undefined : { height: 0, opacity: 0 }}
          transition={T.slow}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Pops a new item in (scale .96 → 1, rise 8 px). `from="end"` slides from the inline end instead (mirrors RTL). */
export function PopIn({
  children,
  from = 'below',
  ...rest
}: DivProps & { from?: 'below' | 'end' | 'start' }) {
  const off = useMotionOff();
  const dx = useDirX();
  const x = from === 'end' ? 16 * dx : from === 'start' ? -16 * dx : 0;
  return (
    <motion.div
      layout={off ? false : 'position'}
      initial={off ? false : { opacity: 0, scale: 0.96, y: from === 'below' ? 8 : 0, x }}
      animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
      exit={off ? undefined : { opacity: 0, scale: 0.98, transition: T.exit }}
      transition={SPRING.pop}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
