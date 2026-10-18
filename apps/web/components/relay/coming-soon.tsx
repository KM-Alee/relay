// Placeholder for screens not built yet (13 §3). Lanes replace their stub page; keep this component.
// Rendered as an EmptyState (docs/design/components.md §3).
import { Hammer } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { NavItem } from '@/nav';
import { EmptyState } from './empty-state';

export async function ComingSoon({ screen }: { screen: NavItem['labelKey'] }) {
  const t = await getTranslations('common');
  return (
    <EmptyState
      data-testid="coming-soon"
      icon={Hammer}
      headingLevel={1}
      className="py-24"
      title={t('comingSoon.title', { screen: t(screen) })}
      description={t('comingSoon.body')}
    />
  );
}
