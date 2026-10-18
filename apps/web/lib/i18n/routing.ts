// Locale routing (docs/07-frontend-i18n.md §1, F7.1–F7.3). Owner: Lane D (T-005 refines).
// `as-needed`: English at `/leads`, Urdu at `/ur/leads`. The URL is the source of truth for locale.
import { defineRouting } from 'next-intl/routing';

export const LOCALES = ['en', 'ur'] as const;
export type Locale = (typeof LOCALES)[number];

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: 'en',
  localePrefix: 'as-needed',
});

export const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ur']);
export const dirOf = (locale: Locale): 'rtl' | 'ltr' => (RTL_LOCALES.has(locale) ? 'rtl' : 'ltr');
