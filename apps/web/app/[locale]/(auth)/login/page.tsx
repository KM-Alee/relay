// /login (F1.1). Owner: Lane B (T-101). Signed-in users go straight to the app.
import { Suspense } from 'react';
import { redirect } from '@/lib/i18n/navigation';
import { getPageActor } from '@/lib/http/page-auth';
import { AuthForm } from '../_components/auth-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  const l = locale === 'ur' ? 'ur' : 'en';
  // Already signed in: go where the user was headed (same-site relative paths only).
  const safe = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
  if (await getPageActor()) redirect({ href: safe, locale: l });
  return (
    <Suspense>
      <AuthForm mode="login" locale={l} />
    </Suspense>
  );
}
