// Pure helpers for Overview / Radar (Lane D). No React here.
import type { Availability as ApiAvailability } from '@relay/contracts/api/users';
import { formatNumber } from '@/lib/format';
import type { Locale } from '@/lib/i18n/routing';
import type { Availability } from '@/components/relay/owner-chip';

/** API enum (`on_leave`) -> component enum (`onLeave`). */
export function toUiAvailability(a: ApiAvailability): Availability {
  return a === 'on_leave' ? 'onLeave' : a;
}

const unit = (locale: Locale, value: number, u: 'hour' | 'minute' | 'second') =>
  formatNumber(locale, value, { style: 'unit', unit: u, unitDisplay: 'narrow', maximumFractionDigits: 0 });

/** "4m 12s", "1h 5m", "38s": locale-aware via Intl unit formatting. */
export function formatDurationShort(locale: Locale, totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return unit(locale, s, 'second');
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r && m < 10
      ? `${unit(locale, m, 'minute')} ${unit(locale, r, 'second')}`
      : unit(locale, m, 'minute');
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${unit(locale, h, 'hour')} ${unit(locale, m, 'minute')}` : unit(locale, h, 'hour');
}

/** Signed percent change `current` vs `previous` as a fraction, null when not comparable. */
export function changeFraction(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

export type FigureId =
  | 'newLeads'
  | 'response'
  | 'recovery'
  | 'payments'
  | 'team'
  | 'pipeline'
  | 'appointments'
  | 'escalations'
  | 'risk'
  | 'about';

export const FIGURE_IDS: readonly FigureId[] = [
  'newLeads',
  'response',
  'recovery',
  'payments',
  'team',
  'pipeline',
  'appointments',
  'escalations',
  'risk',
  'about',
];
