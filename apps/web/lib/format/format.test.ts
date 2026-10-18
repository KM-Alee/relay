import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDate,
  formatMoney,
  formatNumber,
  formatRelative,
  formatTime,
  intlTag,
} from './index';

describe('lib/format', () => {
  it('[F7.4] locale tags are en-PK and ur-PK (Latin digits)', () => {
    expect(intlTag('en')).toBe('en-PK');
    expect(intlTag('ur')).toBe('ur-PK-u-nu-latn');
  });

  it('[F7.4] PKR money from minor units, whole amounts without decimals', () => {
    expect(formatMoney('en', 2_500_000)).toMatch(/^PKR\s25,000$/);
    expect(formatMoney('en', 2_500_050)).toContain('25,000.50');
  });

  it('[F7.4] Urdu numbers use Latin digits by default', () => {
    expect(formatNumber('ur', 1234)).toMatch(/^1.?234$/);
  });

  it('[F7.4] dates render in the workspace time zone, not the machine zone', () => {
    // 2026-10-18T19:30Z is 00:30 on the 19th in Asia/Karachi (UTC+5).
    const d = '2026-10-18T19:30:00Z';
    expect(formatDate('en', d, 'Asia/Karachi')).toContain('19');
    expect(formatDate('en', d, 'UTC')).toContain('18');
    expect(formatTime('en', d, 'Asia/Karachi')).toMatch(/12:30/);
  });

  it('[F7.4] relative time takes an explicit now', () => {
    const now = '2026-10-18T12:00:00Z';
    expect(formatRelative('en', '2026-10-18T11:55:00Z', now)).toBe('5 minutes ago');
    expect(formatRelative('en', '2026-10-18T14:00:00Z', now)).toBe('in 2 hours');
  });

  it('[F3.4] countdown clock text', () => {
    expect(formatClock(102)).toBe('1:42');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-75)).toBe('-1:15');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});
