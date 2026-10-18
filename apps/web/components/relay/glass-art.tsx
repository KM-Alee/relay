// Decorative orange-glass panes (DS-8, screens.md section 11): lightweight SVG, aria-hidden, hidden below 960px,
// never carries data (panes overlap and float, so it can't be misread as a bar chart). Fades out at the bottom
// and at its start edge. Mirrors in RTL.
import { cn } from '@/components/ui/cn';

// x, y, width, height, opacity: overlapping translucent panes, skewed as one group.
const PANES = [
  { x: 60, y: 70, w: 74, h: 190, o: 0.45 },
  { x: 120, y: 30, w: 80, h: 230, o: 0.55 },
  { x: 196, y: 90, w: 70, h: 170, o: 0.5 },
  { x: 250, y: 10, w: 84, h: 250, o: 0.8 },
  { x: 326, y: 60, w: 72, h: 200, o: 0.55 },
  { x: 380, y: 0, w: 90, h: 260, o: 0.95 },
] as const;

export function GlassArt({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 520 320"
      preserveAspectRatio="xMaxYMin meet"
      className={cn(
        'pointer-events-none hidden select-none md:block rtl:-scale-x-100',
        '[mask-image:linear-gradient(to_left,black_50%,transparent)]',
        className,
      )}
    >
      <defs>
        <linearGradient id="glass-pane" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="[stop-color:var(--brand)]" stopOpacity="0.95" />
          <stop offset="0.7" className="[stop-color:var(--brand-soft)]" stopOpacity="0.45" />
          <stop offset="1" className="[stop-color:var(--brand-faint)]" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="glass-glow" cx="0.7" cy="0.4" r="0.6">
          <stop offset="0" className="[stop-color:var(--brand-soft)]" stopOpacity="0.8" />
          <stop offset="1" className="[stop-color:var(--brand-faint)]" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="380" cy="130" rx="260" ry="150" fill="url(#glass-glow)" />
      <g transform="translate(0 92) skewY(-8)">
        {PANES.map((p) => (
          <g key={p.x} opacity={p.o}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="12" fill="url(#glass-pane)" />
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
          </g>
        ))}
      </g>
    </svg>
  );
}
