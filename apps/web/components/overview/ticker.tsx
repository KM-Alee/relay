'use client';
// Number ticker (motion budget Q17: "number tickers on dashboard figures"). Counts from the previous value to
// the next in ~600 ms; with prefers-reduced-motion it jumps. The formatted text is what screen readers get.
import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

export function Ticker({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (reduce || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.6,
      ease: [0.2, 0, 0, 1],
      onUpdate: (v) => setShown(Math.round(v)),
      onComplete: () => {
        from.current = value;
        setShown(value);
      },
    });
    return () => controls.stop();
  }, [value, reduce]);

  return <span className="tabular">{format(shown)}</span>;
}
