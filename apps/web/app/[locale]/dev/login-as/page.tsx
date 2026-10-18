// Dev login (13 §5). Lists seed users; T-101 adds the real "sign in as" POST (session creation).
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { devLoginService } from '@relay/core/services/dev-login';
import { devToolsEnabled } from '@/lib/dev/guard';

export default async function LoginAsPage() {
  if (!devToolsEnabled()) notFound();
  const t = await getTranslations('common');
  const users = await devLoginService.listSeedUsers();
  return (
    <main data-testid="dev-login-as" className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{t('nav.devLoginAs')}</h1>
      <p className="mt-2 opacity-70">{t('dev.loginAsIntro')}</p>
      {users.length === 0 ? (
        <p className="mt-6">{t('dev.noSeedUsers')}</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {users.map((u) => (
            <li key={u.userId}>
              {u.displayName} · {u.email} · {u.baseLevel}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
