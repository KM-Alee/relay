// Sparkline: tiny trend line (--chart-primary) with a brand end-point, in an LTR island (time flows left to right).
// Decorative by default: the KPI figure and delta carry the meaning. Provide `label` for a standalone use.
import { cn } from '@/components/ui/cn';

export function Sparkline({
  data,
  label,
  className,
}: {
  data: readonly number[];
  label?: string;
  className?: string;
}) {
  if (data.length < 2) return null;
  const W = 120;
  const H = 40;
  const pad = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i): [number, number] => [
    pad + (i / (data.length - 1)) * (W - pad * 2),
    H - pad - ((v - min) / span) * (H - pad * 2),
  ]);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn('h-10 w-28 shrink-0 overflow-visible', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={`${line} L${W - pad},${H} L${pad},${H} Z`} className="fill-brand-faint" />
      <path
        d={line}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-chart-primary"
      />
      <circle cx={lx} cy={ly} r={3.5} className="fill-brand stroke-surface" strokeWidth={2} />
    </svg>
  );
}
