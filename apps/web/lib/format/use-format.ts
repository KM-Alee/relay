'use client';
// Hook binding the pure formatters to the active locale + workspace time zone.
import { useLocale, useTimeZone } from 'next-intl';
import { useMemo } from 'react';
import type { Locale } from '@/lib/i18n/routing';
import * as f from './index';

type D = Date | string | number;

export function useFormat() {
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone() ?? f.DEFAULT_TIME_ZONE;
  return useMemo(
    () => ({
      locale,
      timeZone,
      number: (n: number, o?: Intl.NumberFormatOptions) => f.formatNumber(locale, n, o),
      percent: (x: number, digits?: number) => f.formatPercent(locale, x, digits),
      compact: (n: number) => f.formatCompact(locale, n),
      money: (minor: number, currency?: string, o?: { compact?: boolean }) =>
        f.formatMoney(locale, minor, currency, o),
      date: (d: D, o?: Intl.DateTimeFormatOptions) => f.formatDate(locale, d, timeZone, o),
      time: (d: D) => f.formatTime(locale, d, timeZone),
      dateTime: (d: D) => f.formatDateTime(locale, d, timeZone),
      relative: (d: D, now: D) => f.formatRelative(locale, d, now),
      list: (items: string[]) => f.formatList(locale, items),
    }),
    [locale, timeZone],
  );
}
