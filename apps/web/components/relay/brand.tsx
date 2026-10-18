// Hisaab brand (renamed from Relay; internal paths stay components/relay). "Hisaab" = the account,
// the reckoning. The mark is a ledger page (orange, with a soft page stacked behind) carrying an "H": the ledger, kept.
// Every lead accounted for. Token fills only, so it works in light
// and dark; strokes are thick enough to stay crisp at 16px.
import { useTranslations } from 'next-intl';
import { cn } from '@/components/ui/cn';
import { Link } from '@/lib/i18n/navigation';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false" className={cn('size-8 shrink-0', className)}>
      <rect x="8" y="2.5" width="21.5" height="21.5" rx="6" className="fill-brand-soft" />
      <rect x="2.5" y="8" width="22" height="22" rx="6.5" className="fill-brand" />
      <path
        d="M9.5 13.5v11M18 13.5v11M9.5 19h8.5"
        className="fill-none stroke-canvas"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className, textClassName }: { className?: string; textClassName?: string }) {
  const t = useTranslations('common');
  return (
    <Link
      href="/"
      aria-label={t('shell.homeLink')}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-control border-0 pe-2 ps-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    >
      <BrandMark />
      <span
        className={cn('text-[22px] font-semibold leading-none tracking-[-0.02em] text-fg', textClassName)}
      >
        {t('appName')}
      </span>
    </Link>
  );
}

/** "Every lead handed off. None dropped." */
export function Tagline({ className }: { className?: string }) {
  const t = useTranslations('common');
  return <p className={cn('text-meta text-fg-2', className)}>{t('tagline')}</p>;
}
