'use client';
// CountdownRing (components.md §2, docs/07 §4, F3.4, Q8). Ring + NUMERIC mm:ss + icon + label: colour is never
// the only signal. States by fraction remaining: > 50% ok · 20-50% warning · < 20% danger · <= 0 overdue.
// Pulses only in danger/overdue and only without reduced motion (global CSS). Driven by the SERVER deadline
// (`endsAt`) + server-time offset; the UI never decides escalation, it only displays the clock.
import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui/cn';
import { formatClock } from '@/lib/format';
import { Ltr } from './ltr';
import { TimeWarpBadge } from './time-warp-badge';

export type CountdownState = 'ok' | 'warning' | 'danger' | 'overdue';

export function countdownState(remainingMs: number, windowMs: number): CountdownState {
  if (remainingMs <= 0) return 'overdue';
  const f = remainingMs / windowMs;
  if (f > 0.5) return 'ok';
  if (f >= 0.2) return 'warning';
  return 'danger';
}

const STROKE: Record<CountdownState, string> = {
  ok: 'stroke-success',
  warning: 'stroke-warning',
  danger: 'stroke-danger',
  overdue: 'stroke-danger',
};
const TEXT: Record<CountdownState, string> = {
  ok: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  overdue: 'text-danger',
};
const SIZES = {
  20: { box: 20, stroke: 3, text: 'text-meta' },
  40: { box: 40, stroke: 4, text: 'text-meta' },
  96: { box: 96, stroke: 7, text: 'text-panel' },
} as const;

/** Whole seconds since epoch, ticking every second; null on the server / before hydration. */
function useNowSeconds(frozen?: number): number | null {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (frozen !== undefined) return () => {};
      const id = window.setInterval(cb, 1000);
      return () => window.clearInterval(id);
    },
    [frozen],
  );
  return useSyncExternalStore(
    subscribe,
    () => (frozen !== undefined ? Math.floor(frozen / 1000) : Math.floor(Date.now() / 1000)),
    () => null,
  );
}

export function CountdownRing({
  endsAt,
  windowMs,
  size = 40,
  serverOffsetMs = 0,
  nowMs,
  warp,
  showLabel = true,
  className,
}: {
  /** Server `ack_window_ends_at` (ISO string or epoch ms). */
  endsAt: string | number;
  /** Total window length, to compute the fraction remaining. */
  windowMs: number;
  size?: 20 | 40 | 96;
  /** serverNow - clientNow, computed once per session. */
  serverOffsetMs?: number;
  /** Freeze the clock (kitchen sink, tests, screenshots). */
  nowMs?: number;
  /** Time-warp factor; shows the warp badge when not 1 (docs/07 §4). */
  warp?: number;
  /** Severity label beside the ring at >= md ("Escalates in"). */
  showLabel?: boolean;
  className?: string;
}) {
  const t = useTranslations('common');
  const end = typeof endsAt === 'number' ? endsAt : Date.parse(endsAt);
  const nowSec = useNowSeconds(nowMs);
  const tick = nowSec === null ? null : nowMs !== undefined ? nowMs : nowSec * 1000 + serverOffsetMs;

  const remainingMs = tick === null ? null : end - tick;
  const state: CountdownState | null = remainingMs === null ? null : countdownState(remainingMs, windowMs);
  const seconds = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  // Screen-reader time is rounded UP to 30 s buckets, so the label changes at most every 30 s (guide section 10).
  const ariaSeconds = seconds === null ? null : Math.ceil(Math.max(seconds, 0) / 30) * 30;

  const cfg = SIZES[size];
  const r = (cfg.box - cfg.stroke) / 2;
  const circ = 2 * Math.PI * r;
  const fraction = remainingMs === null ? 1 : Math.min(1, Math.max(0, remainingMs / windowMs));
  const Glyph =
    state === 'ok' || state === null ? CircleCheck : state === 'warning' ? TriangleAlert : OctagonAlert;

  const label =
    state === null
      ? ''
      : state === 'overdue'
        ? t('countdown.overdue')
        : state === 'ok'
          ? t('countdown.escalatesIn')
          : t(`countdown.severity.${state}`);
  const clock =
    seconds === null
      ? '–:––'
      : state === 'overdue'
        ? `+${formatClock(Math.abs(seconds))}`
        : formatClock(seconds);
  const aria =
    ariaSeconds === null
      ? t('countdown.loading')
      : state === 'overdue'
        ? t('countdown.ariaOverdue')
        : t('countdown.ariaRemaining', { time: formatClock(ariaSeconds) });

  const insideText = size !== 20;
  return (
    <span
      role="img"
      aria-label={aria}
      data-state={state ?? 'loading'}
      className={cn('inline-flex items-center gap-2', state && TEXT[state], className)}
    >
      <span
        aria-hidden
        className={cn(
          'relative inline-flex shrink-0 items-center justify-center',
          (state === 'danger' || state === 'overdue') && 'anim-pulse',
        )}
        style={{ width: cfg.box, height: cfg.box }}
      >
        <svg width={cfg.box} height={cfg.box} viewBox={`0 0 ${cfg.box} ${cfg.box}`} className="-rotate-90">
          <circle
            cx={cfg.box / 2}
            cy={cfg.box / 2}
            r={r}
            fill="none"
            strokeWidth={cfg.stroke}
            className="stroke-line"
          />
          <circle
            cx={cfg.box / 2}
            cy={cfg.box / 2}
            r={r}
            fill="none"
            strokeWidth={cfg.stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - fraction)}
            className={cn(
              state ? STROKE[state] : 'stroke-line-strong',
              'transition-[stroke-dashoffset] duration-1000 ease-linear',
            )}
          />
        </svg>
        {insideText ? (
          <Ltr
            className={cn(
              'tabular absolute font-semibold',
              size === 40 ? 'text-[11px] leading-none' : 'text-panel',
            )}
          >
            {size === 40 ? clock.replace('+', '') : clock}
          </Ltr>
        ) : null}
      </span>
      {!insideText ? (
        <Ltr aria-hidden className="tabular text-meta font-semibold">
          {clock}
        </Ltr>
      ) : null}
      <Glyph aria-hidden className={cn('size-4 shrink-0', size === 20 && 'hidden')} />
      {showLabel && state ? (
        <span aria-hidden className="hidden text-meta font-medium md:inline">
          {label}
        </span>
      ) : null}
      {warp && warp !== 1 ? <TimeWarpBadge factor={warp} compact /> : null}
      <span role="status" className="sr-only">
        {state && state !== 'ok' ? label : ''}
      </span>
    </span>
  );
}
