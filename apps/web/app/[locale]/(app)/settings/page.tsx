// Settings index (Lane B). CRM configuration lives in subpages; integrations is Lane C's page.
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { requirePage } from '@/lib/http/page-auth';

export default async function Page() {
  await requirePage('settings');
  const t = await getTranslations('crm.settings');
  const links = [
    ['/settings/pipelines', 'pipelines'],
    ['/settings/fields', 'fields'],
    ['/settings/tags', 'tags'],
    ['/settings/onboarding', 'onboarding'],
    ['/settings/integrations', 'integrations'],
    ['/settings/ai', 'ai'],
    ['/settings/knowledge', 'knowledge'],
    ['/settings/templates', 'templates'],
  ] as const;
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <ul className="space-y-2">
        {links.map(([href, key]) => (
          <li key={key}>
            <Link href={href} className="underline">
              {t(`links.${key}`)}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
