// Motion scale (docs/design/tokens.md §4 + components.md §7 motion budget, Q17). Seconds, for `motion`.
// CSS mirrors these as --dur-fast/--dur-base/--dur-slow and --ease-standard (globals.css). Keep them in sync.
// Budget: nav/page fade <= 150 ms, board `layout`, KPI tickers, radar move, countdown danger pulse, <= 5 Lottie.
// Nothing animates to imply an unconfirmed success. `prefers-reduced-motion` turns all of this off.
import type { Transition } from 'motion/react';

export const DUR = {
  /** Hover/press feedback, chip toggles. (--dur-fast) */
  fast: 0.12,
  /** Fades, nav capsule, page enter. (--dur-base) */
  base: 0.15,
  /** Panels, drawers, collapses. (--dur-slow) */
  slow: 0.24,
  /** Number tickers (CountUp). */
  ticker: 0.9,
} as const;

export const EASE = {
  /** --ease-standard: quick start, soft landing. Default for everything. */
  standard: [0.2, 0, 0, 1],
  /** Leaving the screen. */
  exit: [0.4, 0, 1, 1],
  /** Number tickers: long soft tail. */
  outExpo: [0.16, 1, 0.3, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const SPRING = {
  /** Shared-layout moves (nav capsule, tab indicator, selection highlight). Critically damped: no wobble. */
  layout: { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 },
  /** Press feedback. */
  press: { type: 'spring', stiffness: 700, damping: 34 },
  /** Small entrances (bubbles, toasts, badges). */
  pop: { type: 'spring', stiffness: 420, damping: 32 },
} as const satisfies Record<string, Transition>;

export const T = {
  fade: { duration: DUR.base, ease: EASE.standard },
  slow: { duration: DUR.slow, ease: EASE.standard },
  exit: { duration: DUR.fast, ease: EASE.exit },
} as const satisfies Record<string, Transition>;

/** Stagger between siblings: small enough that a 10-item list settles in < 400 ms. */
export const STAGGER = 0.035;
