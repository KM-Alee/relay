'use client';
// BrandGlass: the login panel's living backdrop. Translucent orange panes drift on slow, offset loops over a
// breathing glow. Decorative (aria-hidden, no data). Static under prefers-reduced-motion. Mirrors in RTL.
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/components/ui/cn';

const PANES = [
  { x: 40, y: 120, w: 70, h: 200, o: 0.45, d: 9, a: 14 },
  { x: 120, y: 60, w: 78, h: 250, o: 0.55, d: 11, a: -18 },
  { x: 208, y: 130, w: 68, h: 190, o: 0.5, d: 8, a: 12 },
  { x: 290, y: 30, w: 84, h: 280, o: 0.8, d: 12, a: -14 },
  { x: 388, y: 90, w: 72, h: 220, o: 0.55, d: 10, a: 16 },
  { x: 470, y: 10, w: 88, h: 300, o: 0.95, d: 13, a: -12 },
] as const;

export function BrandGlass({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 600 400"
      preserveAspectRatio="xMaxYMax slice"
      className={cn(
        'pointer-events-none select-none rtl:-scale-x-100',
        '[mask-image:linear-gradient(to_top,black_45%,transparent)]',
        className,
      )}
    >
      <defs>
        <linearGradient id="bg-pane" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="[stop-color:var(--brand)]" stopOpacity="0.95" />
          <stop offset="0.7" className="[stop-color:var(--brand-soft)]" stopOpacity="0.45" />
          <stop offset="1" className="[stop-color:var(--brand-faint)]" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="bg-glow" cx="0.6" cy="0.5" r="0.6">
          <stop offset="0" className="[stop-color:var(--brand-soft)]" stopOpacity="0.9" />
          <stop offset="1" className="[stop-color:var(--brand-faint)]" stopOpacity="0" />
        </radialGradient>
      </defs>
      <motion.ellipse
        cx="380"
        cy="200"
        rx="300"
        ry="190"
        fill="url(#bg-glow)"
        animate={reduce ? undefined : { opacity: [0.65, 1, 0.65], scale: [1, 1.06, 1] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '380px 200px' }}
      />
      <g transform="skewY(-8) translate(0 60)">
        {PANES.map((p) => (
          <motion.g
            key={p.x}
            opacity={p.o}
            animate={reduce ? undefined : { y: [0, p.a, 0] }}
            transition={{ duration: p.d, repeat: Infinity, ease: 'easeInOut' }}
          >
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="12" fill="url(#bg-pane)" />
            <rect
              x={p.x + 0.5}
              y={p.y + 0.5}
              width={p.w - 1}
              height={p.h - 1}
              rx="11.5"
              fill="none"
              strokeWidth="1"
              className="stroke-surface"
              strokeOpacity="0.7"
            />
            <path
              d={`M${p.x + 10} ${p.y + 14} L${p.x + p.w * 0.55} ${p.y + 14}`}
              strokeWidth="3"
              strokeLinecap="round"
              className="stroke-surface"
              strokeOpacity="0.6"
            />
          </motion.g>
        ))}
      </g>
    </svg>
  );
}
