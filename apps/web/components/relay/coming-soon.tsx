// Placeholder for screens not built yet (13 §3). Lanes replace their stub page; keep this component.
// Lane D restyles it as an EmptyState (docs/design/components.md).
import { getTranslations } from 'next-intl/server';
import type { NavItem } from '@/nav';

export async function ComingSoon({ screen }: { screen: NavItem['labelKey'] }) {
  const t = await getTranslations('common');
  return (
    <main data-testid="coming-soon" className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t('comingSoon.title', { screen: t(screen) })}</h1>
      <p className="mt-2 opacity-70">{t('comingSoon.body')}</p>
    </main>
  );
}
