'use client';
// Toast (components.md §5): bottom-end, polite live region. Say "sent/paid" only after real confirmation.
// Use `toast.success(t('…'))` / `toast.error(localizeError(err, t))`; critical failures also stay inline.
import { useLocale } from 'next-intl';
import { Toaster as Sonner, toast } from 'sonner';
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
      style={
        {
          '--normal-bg': 'var(--surface)',
          '--normal-text': 'var(--text-primary)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--success-surface)',
          '--success-text': 'var(--success)',
          '--success-border': 'var(--success)',
          '--error-bg': 'var(--danger-surface)',
          '--error-text': 'var(--danger)',
          '--error-border': 'var(--danger)',
          '--border-radius': 'var(--radius-card)',
          zIndex: 'var(--z-toast)',
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: 'shadow-pop text-body', description: 'text-meta' } }}
    />
  );
}
