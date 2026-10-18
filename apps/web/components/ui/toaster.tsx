'use client';
// Toast (components.md §5): bottom-end, polite live region. Say "sent/paid" only after real confirmation.
// Use `toast.success(t('…'))` / `toast.error(localizeError(err, t))`; critical failures also stay inline.
// Success toasts play the budget "success" Lottie once (still frame under reduced motion); errors stay
// on the danger surface so failures are never mistaken for success.
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Toaster as Sonner, toast } from 'sonner';
import { RelayLottie } from '@/components/relay/lottie';
import { dirOf, type Locale } from '@/lib/i18n/routing';

export { toast };

export function Toaster() {
  const locale = useLocale() as Locale;
  const rtl = dirOf(locale) === 'rtl';
  return (
    <Sonner
      dir={dirOf(locale)}
      position={rtl ? 'bottom-left' : 'bottom-right'}
      closeButton
      gap={10}
      offset={20}
      icons={{
        success: <RelayLottie name="success" className="-m-1 size-7" />,
        error: <CircleAlert aria-hidden className="size-5 text-danger" />,
        warning: <TriangleAlert aria-hidden className="size-5 text-warning" />,
        info: <Info aria-hidden className="size-5 text-info" />,
      }}
      style={
        {
          '--normal-bg': 'var(--surface)',
          '--normal-text': 'var(--text-primary)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--surface)',
          '--success-text': 'var(--text-primary)',
          '--success-border': 'var(--border)',
          '--error-bg': 'var(--danger-surface)',
          '--error-text': 'var(--danger)',
          '--error-border': 'var(--danger)',
          '--border-radius': 'var(--radius-card)',
          zIndex: 'var(--z-toast)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'relay-toast shadow-pop text-body gap-3 px-4 py-3.5',
          title: 'font-medium',
          description: 'text-meta text-fg-2',
          closeButton: 'relay-toast-close',
        },
      }}
    />
  );
}
