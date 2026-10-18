// /signup (F1.1). Owner: Lane B (T-101). Creates a workspace + Owner, then signs in.
import { Suspense } from 'react';
import { redirect } from '@/lib/i18n/navigation';
import { getPageActor } from '@/lib/http/page-auth';
import { AuthForm } from '../_components/auth-form';

export const dynamic = 'force-dynamic';

export default async function SignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const l = locale === 'ur' ? 'ur' : 'en';
  if (await getPageActor()) redirect({ href: '/', locale: l });
  return (
    <Suspense>
      <AuthForm mode="signup" locale={l} />
    </Suspense>
  );
}
