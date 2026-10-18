// /invite/[token] (F1.2): public. The token is only ever sent to the API in a POST body; the page itself
// asks the browser not to leak the URL as a referrer.
import type { Metadata } from 'next';
import { QueryProvider } from '@/lib/query/provider';
import { AcceptInvite } from './accept-invite';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  return (
    <QueryProvider>
      <AcceptInvite token={token} locale={locale === 'ur' ? 'ur' : 'en'} />
    </QueryProvider>
  );
}
