// Locale-aware formatting (docs/07 §5, F7.1/F7.4). Owner: Lane D.
// Never call toLocaleString()/toFixed for display and never build dates by hand: use these.
// `en` -> en-PK, `ur` -> ur-PK with Latin digits (`-u-nu-latn`; a later setting may switch numerals).
import type { Locale } from '@/lib/i18n/routing';

export const DEFAULT_TIME_ZONE = 'Asia/Karachi';
export const DEFAULT_CURRENCY = 'PKR';

const TAGS: Record<Locale, string> = { en: 'en-PK', ur: 'ur-PK-u-nu-latn' };
export const intlTag = (locale: Locale): string => TAGS[locale];

type DateInput = Date | string | number;
const toDate = (d: DateInput): Date => (d instanceof Date ? d : new Date(d));

export function formatNumber(locale: Locale, value: number, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(intlTag(locale), opts).format(value);
}

export function formatPercent(locale: Locale, fraction: number, maximumFractionDigits = 0): string {
  return formatNumber(locale, fraction, { style: 'percent', maximumFractionDigits });
}

/** Compact figures for KPI tiles and chart axes: 1.2M, 12K. */
export function formatCompact(locale: Locale, value: number): string {
  return formatNumber(locale, value, { notation: 'compact', maximumFractionDigits: 1 });
}

/** ISO 4217 minor-unit exponent. NOT Intl's display digits (CLDR shows PKR with 0 decimals). */
const MINOR_DIGITS: Record<string, number> = { PKR: 2, USD: 2, EUR: 2, GBP: 2, AED: 2, JPY: 0, KWD: 3 };

/**
 * Money from MINOR units (paisa for PKR). Whole amounts drop the decimals: "PKR 25,000".
 * `currencyDisplay: 'code'` keeps the ISO code visible for unambiguous reporting (I2.6).
 */
export function formatMoney(
  locale: Locale,
  minor: number,
  currency: string = DEFAULT_CURRENCY,
  opts: { compact?: boolean } = {},
): string {
  const digits = MINOR_DIGITS[currency] ?? 2;
  const major = minor / 10 ** digits;
  const whole = Number.isInteger(major);
  return new Intl.NumberFormat(intlTag(locale), {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    ...(opts.compact
      ? { notation: 'compact', maximumFractionDigits: 1 }
      : { minimumFractionDigits: whole ? 0 : digits, maximumFractionDigits: digits }),
  }).format(major);
}

export function formatDate(
  locale: Locale,
  date: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat(intlTag(locale), { timeZone, ...opts }).format(toDate(date));
}

export function formatTime(locale: Locale, date: DateInput, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(toDate(date));
}

export function formatDateTime(
  locale: Locale,
  date: DateInput,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(toDate(date));
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

/** "5 minutes ago" / "in 2 hours". `now` is passed in (server clock + offset), never read here. */
export function formatRelative(locale: Locale, date: DateInput, now: DateInput): string {
  const diffSec = Math.round((toDate(date).getTime() - toDate(now).getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const [unit, size] = UNITS.find(([, s]) => abs >= s) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(intlTag(locale), { numeric: 'auto' }).format(
    Math.trunc(diffSec / size),
    unit,
  );
}

/** Countdown text `m:ss` (or `h:mm:ss`); always LTR, wrap in <Ltr>. Negative values keep the sign. */
export function formatClock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : '';
  const s = Math.abs(Math.trunc(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${sign}${h}:${String(m).padStart(2, '0')}:${ss}` : `${sign}${m}:${ss}`;
}

export function formatList(locale: Locale, items: string[]): string {
  return new Intl.ListFormat(intlTag(locale), { style: 'long', type: 'conjunction' }).format(items);
}
