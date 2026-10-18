'use client';
// Local motion helpers for Overview/Radar (Q17 motion budget): staggered entrance + hover lift. Everything is
// a no-op under prefers-reduced-motion. (A shared kit may replace this later; keep usage to these two exports.)
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

export function Reveal({
  i = 0,
  className,
  children,
  lift = true,
}: {
  /** Stagger index: each step delays 60 ms (capped). */
  i?: number;
  className?: string;
  children: ReactNode;
  lift?: boolean;
}) {
  const reduce = useReducedMotion();
  const cls = `h-full ${className ?? ''}`;
  if (reduce) return <div className={cls}>{children}</div>;
  return (
    <motion.div
      className={cls}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0, 0, 1], delay: Math.min(i, 8) * 0.06 }}
      whileHover={lift ? { y: -2, transition: { duration: 0.15 } } : undefined}
    >
      {children}
    </motion.div>
  );
}

/** Left-to-right wipe used for chart reveals (time flows LTR in the chart island). */
export function Wipe({ className, children }: { className?: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ clipPath: 'inset(0 100% 0 0)' }}
      animate={{ clipPath: 'inset(0 0% 0 0)' }}
      transition={{ duration: 0.9, ease: [0.2, 0, 0, 1], delay: 0.25 }}
    >
      {children}
    </motion.div>
  );
}

/** Fade/slide for tab panels. */
export function PanelFade({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className="flex flex-col gap-6">{children}</div>;
  return (
    <motion.div
      className="flex flex-col gap-6"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
    >
      {children}
    </motion.div>
  );
}
