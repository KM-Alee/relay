// Clock + time-warp (docs/01-architecture.md §7, F10.2). Owner: Lane A.
// We never fake wall time: `now()` is the real clock. Time-warp scales DURATIONS only:
//   effectiveSeconds = configuredSeconds / workspace.time_warp_multiplier
// Every business deadline (ack windows, retries, idle checks) goes through `deadline()`.
// core/domain never imports this file: it receives `now` (and already-scaled windows) as arguments.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Anything carrying the workspace's multiplier (`workspaces.time_warp_multiplier`, numeric → string). */
export interface WarpSource {
  timeWarpMultiplier: number | string;
}

function multiplierOf(ws: WarpSource): number {
  const m = typeof ws.timeWarpMultiplier === 'string' ? Number(ws.timeWarpMultiplier) : ws.timeWarpMultiplier;
  // The DB enforces > 0; defend against NaN/0 so a bad value can never produce an instant deadline.
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/** Configured seconds → effective milliseconds under the workspace's time-warp. */
export function effectiveMs(ws: WarpSource, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('duration must be a non-negative number');
  return Math.round((seconds * 1000) / multiplierOf(ws));
}

/** `now + seconds`, scaled by time-warp. The ONLY way to compute a business deadline. */
export function deadline(ws: WarpSource, seconds: number, now: Date): Date {
  return new Date(now.getTime() + effectiveMs(ws, seconds));
}

export const clock = {
  now: () => systemClock.now(),
  deadline: (ws: WarpSource, seconds: number, now: Date = systemClock.now()) => deadline(ws, seconds, now),
  effectiveMs,
};
