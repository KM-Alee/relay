'use client';
// Minimal, i18n'd sign-in / sign-up form (T-101). Plain semantic markup; Lane D restyles with the
// design system. Calls the typed api-client (CSRF handled there) and then navigates.
import { CircleAlert, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/relay/form-field';
import { api, localizeError } from '@/lib/api-client';
import { Link, useRouter } from '@/lib/i18n/navigation';

/** Only same-site relative paths (no open redirect). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

export function AuthForm({ mode, locale }: { mode: 'login' | 'signup'; locale: 'en' | 'ur' }) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const te = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '');
    try {
      if (mode === 'login') await api.auth.login({ email: s('email'), password: s('password') });
      else
        await api.auth.signup({
          workspaceName: s('workspaceName'),
          name: s('name'),
          email: s('email'),
          password: s('password'),
          locale,
        });
      router.replace(safeNext(params.get('next')));
      router.refresh();
    } catch (err) {
      setError(localizeError(err, (k, v) => te(k, v)));
      setBusy(false);
    }
  }

  return (
    <main className="w-full max-w-md">
      <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
        <h1 className="text-page text-fg">{t(`${mode}.title`)}</h1>
        <p className="mt-1 text-body text-fg-2">
          {tc(mode === 'login' ? 'brand.welcomeSub' : 'brand.signupSub')}
        </p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate={false}>
          {mode === 'signup' && (
            <>
              <FormField label={t('fields.workspaceName')} required>
                {(p) => <Input {...p} name="workspaceName" required maxLength={80} />}
              </FormField>
              <FormField label={t('fields.name')} required>
                {(p) => <Input {...p} name="name" required maxLength={80} autoComplete="name" />}
              </FormField>
            </>
          )}
          <FormField label={t('fields.email')} required>
            {(p) => <Input {...p} name="email" type="email" required autoComplete="email" dir="ltr" />}
          </FormField>
          <FormField
            label={t('fields.password')}
            required
            helper={mode === 'signup' ? t('fields.passwordHint') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                name="password"
                type="password"
                required
                minLength={mode === 'signup' ? 10 : 1}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                dir="ltr"
              />
            )}
          </FormField>
          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-control bg-danger-surface px-3 py-2 text-body text-danger"
            >
              <CircleAlert aria-hidden className="mt-1 size-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-1 w-full">
            {t(`${mode}.submit`)}
          </Button>
        </form>
        <p className="mt-6 border-t border-line pt-4 text-body text-fg-2">
          {mode === 'login' ? (
            <Link href="/signup" className="font-medium text-brand-text underline-offset-4 hover:underline">
              {t('login.toSignup')}
            </Link>
          ) : (
            <Link href="/login" className="font-medium text-brand-text underline-offset-4 hover:underline">
              {t('signup.toLogin')}
            </Link>
          )}
        </p>
      </div>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-meta text-fg-muted">
        <Lock aria-hidden className="size-3.5" />
        {tc('brand.secure')}
      </p>
    </main>
  );
}
