'use client';
// Minimal, i18n'd sign-in / sign-up form (T-101). Plain semantic markup; Lane D restyles with the
// design system. Calls the typed api-client (CSRF handled there) and then navigates.
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, localizeError } from '@/lib/api-client';
import { Link, useRouter } from '@/lib/i18n/navigation';

/** Only same-site relative paths (no open redirect). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

export function AuthForm({ mode, locale }: { mode: 'login' | 'signup'; locale: 'en' | 'ur' }) {
  const t = useTranslations('auth');
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
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-2xl font-semibold">{t(`${mode}.title`)}</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate={false}>
        {mode === 'signup' && (
          <>
            <label className="flex flex-col gap-1">
              <span>{t('fields.workspaceName')}</span>
              <input name="workspaceName" required maxLength={80} className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1">
              <span>{t('fields.name')}</span>
              <input
                name="name"
                required
                maxLength={80}
                autoComplete="name"
                className="rounded border px-3 py-2"
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1">
          <span>{t('fields.email')}</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            dir="ltr"
            className="rounded border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('fields.password')}</span>
          <input
            name="password"
            type="password"
            required
            minLength={mode === 'signup' ? 10 : 1}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            dir="ltr"
            className="rounded border px-3 py-2"
          />
          {mode === 'signup' && <span className="text-sm opacity-70">{t('fields.passwordHint')}</span>}
        </label>
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="rounded border px-3 py-2 font-medium">
          {t(`${mode}.submit`)}
        </button>
      </form>
      <p className="mt-6 text-sm">
        {mode === 'login' ? (
          <Link href="/signup">{t('login.toSignup')}</Link>
        ) : (
          <Link href="/login">{t('signup.toLogin')}</Link>
        )}
      </p>
    </main>
  );
}
