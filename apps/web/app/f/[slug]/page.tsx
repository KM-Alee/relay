// Public web form `/f/[slug]` (T-122, F3.1): no login; honeypot + per-IP rate limit + server validation
// on POST /api/public/forms/:slug. Success confirmation whatever the routing outcome. Owner: Lane A.
import { leadsService } from '@relay/core/services/leads';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PublicForm } from './public-form';

export const dynamic = 'force-dynamic';

export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(slug)) notFound();
  const form = await leadsService.getPublicForm(slug);
  if (!form) notFound();
  const t = await getTranslations({ locale: 'en', namespace: 'leads.form' });
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-2 text-page font-semibold text-fg">{t('title', { business: form.title })}</h1>
      <p className="mb-6 text-body text-fg-2">{t('intro')}</p>
      <PublicForm slug={slug} />
    </main>
  );
}
