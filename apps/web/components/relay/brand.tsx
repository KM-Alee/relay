// Relay brand: logo mark (a baton being handed off: orange baton + charcoal baton, one clean overlap),
// wordmark and tagline. The charcoal baton uses currentColor-like token fill so it works in light and dark.
import { useTranslations } from 'next-intl';
import { cn } from '@/components/ui/cn';
import { Link } from '@/lib/i18n/navigation';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false" className={cn('size-8 shrink-0', className)}>
      {/* the charcoal baton hands over to the orange baton */}
      <rect
        x="3"
        y="15"
        width="17"
        height="7"
        rx="3.5"
        transform="rotate(-40 11.5 18.5)"
        className="fill-fg"
      />
      <rect
        x="12"
        y="9.5"
        width="17"
        height="7"
        rx="3.5"
        transform="rotate(-40 20.5 13)"
        className="fill-brand stroke-canvas"
        strokeWidth="1.6"
      />
      <circle cx="25.5" cy="25" r="2.6" className="fill-brand" />
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
      <span className={cn('text-[22px] font-semibold leading-none tracking-tight text-fg', textClassName)}>
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
