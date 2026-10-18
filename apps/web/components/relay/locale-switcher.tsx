'use client';
// Locale switcher (F7.1): keeps the path and query, swaps the locale prefix. The URL is the source of truth.
// Later (T-101): also PATCH users.locale so the choice follows the user across devices.
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/components/ui/cn';
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { usePathname, useRouter } from '@/lib/i18n/navigation';
import { routing, type Locale } from '@/lib/i18n/routing';

function useSwitchLocale() {
  const router = useRouter();
  const pathname = usePathname();
  // Read the query at click time (no useSearchParams, so no Suspense boundary is forced on pages).
  return (next: Locale) =>
    router.replace(
      { pathname, query: Object.fromEntries(new URLSearchParams(window.location.search)) },
      { locale: next },
    );
}

/** Segmented control. Each option is labelled in its OWN language (endonym), with `lang` set. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const switchTo = useSwitchLocale();
  return (
    <div
      role="radiogroup"
      aria-label={t('locale.label')}
      className={cn('inline-flex rounded-control bg-surface-muted p-1', className)}
    >
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          lang={l}
          aria-checked={locale === l}
          onClick={() => locale !== l && switchTo(l)}
          className={cn(
            'inline-flex min-h-10 items-center rounded-control px-3 text-button text-fg-2 transition-colors',
            locale === l ? 'bg-surface text-fg shadow-card' : 'hover:text-fg',
          )}
        >
          {t(`locale.${l}`)}
        </button>
      ))}
    </div>
  );
}

export function LocaleRadioItems() {
  const t = useTranslations('common');
  const locale = useLocale();
  const switchTo = useSwitchLocale();
  return (
    <>
      <DropdownMenuLabel>{t('locale.label')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={locale} onValueChange={(v) => switchTo(v as Locale)}>
        {routing.locales.map((l) => (
          <DropdownMenuRadioItem key={l} value={l} lang={l}>
            {t(`locale.${l}`)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}
