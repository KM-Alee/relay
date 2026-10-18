// Bookable slot generation for the public instant-booking page (I3.8). Pure: `now` passed in.
// Working hours Mon-Sat 10:00-18:00 in Asia/Karachi (UTC+5, no DST), 30-minute slots, at least 2 h of
// lead time, next 5 working days. A slot is offered only if it overlaps no busy block (free/busy, I3.4).
export const BOOKING_TZ = 'Asia/Karachi';
const PKT_OFFSET_MS = 5 * 3600_000;
const SLOT_MS = 30 * 60_000;
const MIN_LEAD_MS = 2 * 3600_000;
const DAY_MS = 24 * 3600_000;
export const BOOKING_HORIZON_DAYS = 7;

export interface Slot {
  startsAt: string;
  endsAt: string;
}
export interface BusyBlock {
  start: Date;
  end: Date;
}

/** [from, to) window the availability lookup must cover. */
export function bookingWindow(now: Date): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + (BOOKING_HORIZON_DAYS + 1) * DAY_MS) };
}

export function computeSlots(now: Date, busy: readonly BusyBlock[]): Slot[] {
  const pktNow = new Date(now.getTime() + PKT_OFFSET_MS);
  const dayStartUtc =
    Date.UTC(pktNow.getUTCFullYear(), pktNow.getUTCMonth(), pktNow.getUTCDate()) - PKT_OFFSET_MS;
  const out: Slot[] = [];
  let workingDays = 0;
  for (let d = 0; d <= BOOKING_HORIZON_DAYS && workingDays < 5; d++) {
    const midnight = dayStartUtc + d * DAY_MS;
    const weekday = new Date(midnight + PKT_OFFSET_MS).getUTCDay(); // 0 = Sunday (PKT)
    if (weekday === 0) continue;
    let any = false;
    for (let t = midnight + 10 * 3600_000; t + SLOT_MS <= midnight + 18 * 3600_000; t += SLOT_MS) {
      if (t < now.getTime() + MIN_LEAD_MS) continue;
      if (busy.some((b) => b.start.getTime() < t + SLOT_MS && b.end.getTime() > t)) continue;
      out.push({ startsAt: new Date(t).toISOString(), endsAt: new Date(t + SLOT_MS).toISOString() });
      any = true;
    }
    if (any) workingDays++;
  }
  return out;
}
