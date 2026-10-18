'use client';
// Motion primitives (Q17). Every primitive honours `prefers-reduced-motion` through `useReducedMotion()`:
// reduced = render the final state immediately (no transform, no fade, no stagger).
// RTL: horizontal offsets go through `useDirX()` so "slide from the end" mirrors (docs/07 §6).
//
//   <FadeIn y={8}>…</FadeIn>                      fade + rise on mount
//   <Stagger><StaggerItem>…</StaggerItem></Stagger>  children cascade in
//   <Reveal>…</Reveal>                            fade + rise once when scrolled into view
//   <Pressable>…</Pressable>                      hover lift + press squeeze (wrap a button/card)
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { useLocale } from 'next-intl';
import type { ReactNode } from 'react';
import { dirOf, type Locale } from '@/lib/i18n/routing';
import { DUR, EASE, SPRING, STAGGER } from './tokens';

/** `1` in LTR, `-1` in RTL: multiply horizontal motion offsets by this. */
export function useDirX(): 1 | -1 {
  return dirOf(useLocale() as Locale) === 'rtl' ? -1 : 1;
}

/** True when motion should be skipped (OS setting). SSR renders as "motion allowed" and settles on hydrate. */
export function useMotionOff(): boolean {
  return useReducedMotion() ?? false;
}

type Tag = 'div' | 'section' | 'li' | 'ul' | 'span' | 'article' | 'header';

type BaseProps = Omit<HTMLMotionProps<'div'>, 'children'> & { children?: ReactNode; as?: Tag };

/** Static tag → motion component map (components must not be created during render). */
const TAGS = {
  div: motion.div,
  section: motion.section,
  li: motion.li,
  ul: motion.ul,
  span: motion.span,
  article: motion.article,
  header: motion.header,
} as unknown as Record<Tag, typeof motion.div>;

export function FadeIn({
  as,
  y = 6,
  x = 0,
  delay = 0,
  duration = DUR.slow,
  children,
  ...rest
}: BaseProps & { y?: number; x?: number; delay?: number; duration?: number }) {
  const off = useMotionOff();
  const dx = useDirX();
  const M = TAGS[as ?? 'div'];
  return (
    <M
      initial={off ? false : { opacity: 0, y, x: x * dx }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration, delay, ease: EASE.standard }}
      {...rest}
    >
      {children}
    </M>
  );
}

const staggerParent = (gap: number, delay: number) => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});
const staggerChild = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE.standard } },
};

/** Container: its `StaggerItem` children enter one after another. `inView` waits until it scrolls in. */
export function Stagger({
  as,
  gap = STAGGER,
  delay = 0,
  inView = false,
  children,
  ...rest
}: BaseProps & { gap?: number; delay?: number; inView?: boolean }) {
  const off = useMotionOff();
  const M = TAGS[as ?? 'div'];
  return (
    <M
      variants={staggerParent(gap, delay)}
      initial={off ? false : 'hidden'}
      {...(inView ? { whileInView: 'show', viewport: { once: true, margin: '-40px' } } : { animate: 'show' })}
      {...rest}
    >
      {children}
    </M>
  );
}

export function StaggerItem({ as, children, ...rest }: BaseProps) {
  const M = TAGS[as ?? 'div'];
  return (
    <M variants={staggerChild} {...rest}>
      {children}
    </M>
  );
}

/** Fades + rises once when it scrolls into view (long pages, below-the-fold cards). */
export function Reveal({ as, y = 12, children, ...rest }: BaseProps & { y?: number }) {
  const off = useMotionOff();
  const M = TAGS[as ?? 'div'];
  return (
    <M
      initial={off ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: DUR.slow * 1.5, ease: EASE.standard }}
      {...rest}
    >
      {children}
    </M>
  );
}

/**
 * Hover lift + press squeeze. Wrap an interactive element (the wrapper itself is not focusable):
 * `<Pressable><Button>…</Button></Pressable>`. `lift` = px to rise on hover (cards), 0 for buttons.
 */
export function Pressable({
  as = 'div',
  scale = 0.97,
  lift = 0,
  children,
  className,
  ...rest
}: BaseProps & { scale?: number; lift?: number }) {
  const off = useMotionOff();
  const M = TAGS[as ?? 'div'];
  return (
    <M
      className={className ?? 'inline-flex'}
      whileHover={off ? undefined : { y: -lift }}
      whileTap={off ? undefined : { scale }}
      transition={SPRING.press}
      {...rest}
    >
      {children}
    </M>
  );
}
