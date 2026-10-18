'use client';
// CountUp: KPI number ticker (motion budget item, Q17). Intl-aware: every frame goes through `format`
// (default: the active locale's number format), so "PKR 1,250,000" ticks as currency, never as a raw float.
// SSR + screen readers get the FINAL value (sr-only twin; the ticking text is aria-hidden).
// Reduced motion: jumps straight to the final value. Re-animates from the previous value when `value` changes.
//
//   <CountUp value={collectedMinor / 100} format={(n) => fmt.number(n, { style: 'currency', currency })} />
import { animate, useInView } from 'motion/react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFormat } from '@/lib/format/use-format';
import { cn } from '@/components/ui/cn';
import { useMotionOff } from './primitives';
import { DUR, EASE } from './tokens';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Write into React's own text node (keeps reconciliation intact; no re-render per frame). */
function write(el: HTMLElement | null, text: string) {
  if (!el) return;
  const node = el.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE) node.nodeValue = text;
  else el.textContent = text;
}

export function CountUp({
  value,
  from = 0,
  format,
  decimals = 0,
  duration = DUR.ticker,
  className,
}: {
  value: number;
  /** Start of the first animation (later changes animate from the previous value). */
  from?: number;
  /** Formats every frame. Use Intl via useFormat()/useFormatter(); keep it stable-ish (it's called per frame). */
  format?: (n: number) => string;
  /** Rounding for the default formatter. */
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const f = useFormat();
  const off = useMotionOff();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20px' });
  const prev = useRef<number | null>(null);
  const fmt =
    format ??
    ((n: number) => f.number(n, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  const fmtRef = useRef(fmt);
  useIsoLayoutEffect(() => {
    fmtRef.current = fmt;
  });

  // Before paint: show the start value so the first frame never flashes the final number.
  useIsoLayoutEffect(() => {
    if (off || prev.current !== null || !ref.current) return;
    write(ref.current, fmtRef.current(from));
  }, [off, from]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (off) {
      write(el, fmtRef.current(value));
      prev.current = value;
      return;
    }
    if (!inView) return;
    const start = prev.current ?? from;
    prev.current = value;
    if (start === value) {
      write(el, fmtRef.current(value));
      return;
    }
    const controls = animate(start, value, {
      duration,
      ease: EASE.outExpo,
      onUpdate: (n) => {
        write(el, fmtRef.current(decimals === 0 && Number.isInteger(value) ? Math.round(n) : n));
      },
    });
    return () => controls.stop();
  }, [value, inView, off, from, duration, decimals]);

  const final = fmt(value);
  return (
    <span className={cn('tabular', className)}>
      <span ref={ref} aria-hidden="true">
        {final}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
