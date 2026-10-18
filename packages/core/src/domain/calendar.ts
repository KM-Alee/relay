// Calendar domain rules (I3.3-I3.7). PURE: no I/O, `now` passed in. Owner: Lane C (T-144).

export interface Interval {
  start: Date;
  end: Date;
}

/** Half-open overlap: touching intervals (one ends when the next starts) do NOT conflict. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function findConflicts<T extends Interval>(slot: Interval, busy: readonly T[]): T[] {
  return busy.filter((b) => overlaps(slot, b));
}

/** Merge overlapping/adjacent intervals (the grid only needs the union). */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/**
 * Deterministic Google event id from the appointment uuid: Google ids must be 5-1024 chars of base32hex
 * (a-v, 0-9); the 32 hex chars of the uuid are a valid subset. Retries therefore never duplicate (I3.3).
 */
export function eventIdFor(appointmentId: string): string {
  return appointmentId.replaceAll('-', '').toLowerCase();
}

export type CalendarStatus = 'not_connected' | 'connected' | 'needs_reconnect' | 'error';
export type NotBookableReason = 'no_calendar_connected' | 'needs_reconnect' | 'calendar_error';

/** I3.7: an employee without a connected calendar cannot be booked, and the reason is explicit. */
export function bookability(
  status: CalendarStatus | null,
): { bookable: true; reason: null } | { bookable: false; reason: NotBookableReason } {
  if (status === 'connected') return { bookable: true, reason: null };
  if (status === 'needs_reconnect') return { bookable: false, reason: 'needs_reconnect' };
  if (status === 'error') return { bookable: false, reason: 'calendar_error' };
  return { bookable: false, reason: 'no_calendar_connected' };
}

/** Access tokens are refreshed when within this window of expiry (I3.2). */
export const REFRESH_WINDOW_MS = 5 * 60_000;
export const needsRefresh = (expiresAt: Date | null, now: Date): boolean =>
  !expiresAt || expiresAt.getTime() - now.getTime() <= REFRESH_WINDOW_MS;

/** Offset (ms) of `tz` from UTC at the instant `at`. */
function tzOffsetMs(at: Date, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Wall-clock `YYYY-MM-DD` + `HH:mm` in an IANA zone -> the UTC instant (I3.5). DST-safe via a second pass. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
