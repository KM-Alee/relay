import { describe, expect, it } from 'vitest';
import { bookability, eventIdFor, findConflicts, needsRefresh, overlaps, zonedToUtc } from './calendar';

const d = (s: string) => new Date(s);

describe('calendar domain', () => {
  it('[I3.4] intervals that merely touch do not conflict; overlapping ones do', () => {
    const a = { start: d('2031-01-14T09:00Z'), end: d('2031-01-14T10:00Z') };
    expect(overlaps(a, { start: d('2031-01-14T10:00Z'), end: d('2031-01-14T11:00Z') })).toBe(false);
    expect(findConflicts(a, [{ start: d('2031-01-14T09:30Z'), end: d('2031-01-14T09:45Z') }])).toHaveLength(
      1,
    );
  });

  it('[I3.5] wall-clock time in an IANA zone converts to the right UTC instant (incl. DST)', () => {
    expect(zonedToUtc('2031-01-14', '10:00', 'Asia/Karachi').toISOString()).toBe('2031-01-14T05:00:00.000Z'); // +05:00
    expect(zonedToUtc('2031-07-01', '09:00', 'America/New_York').toISOString()).toBe(
      '2031-07-01T13:00:00.000Z',
    ); // EDT
    expect(zonedToUtc('2031-01-01', '09:00', 'America/New_York').toISOString()).toBe(
      '2031-01-01T14:00:00.000Z',
    ); // EST
  });

  it('[I3.3] event ids are deterministic base32hex-safe', () => {
    const id = eventIdFor('0192f3a0-0000-7000-8000-000000000b01');
    expect(id).toMatch(/^[0-9a-v]{32}$/);
    expect(eventIdFor('0192F3A0-0000-7000-8000-000000000B01')).toBe(id);
  });

  it('[I3.7] only a connected calendar is bookable, with an explicit reason otherwise', () => {
    expect(bookability('connected')).toEqual({ bookable: true, reason: null });
    expect(bookability(null)).toEqual({ bookable: false, reason: 'no_calendar_connected' });
    expect(bookability('needs_reconnect')).toEqual({ bookable: false, reason: 'needs_reconnect' });
  });

  it('[I3.2] tokens refresh when within 5 minutes of expiry', () => {
    const now = d('2031-01-14T09:00Z');
    expect(needsRefresh(d('2031-01-14T09:04Z'), now)).toBe(true);
    expect(needsRefresh(d('2031-01-14T09:30Z'), now)).toBe(false);
    expect(needsRefresh(null, now)).toBe(true);
  });
});
