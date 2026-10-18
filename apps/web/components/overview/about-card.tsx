'use client';
// "About Relay" card shown on Overview in DEMO_MODE workspaces: the core promise in three lines (selling point).
import { BotMessageSquare, ChevronRight, RadioTower, UserCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BrandMark } from '@/components/relay/brand';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Link } from '@/lib/i18n/navigation';

export function AboutCard({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations('overview.about');
  const c = useTranslations('common');
  const points = [
    { icon: UserCheck, text: t('points.owner') },
    { icon: RadioTower, text: t('points.escalate') },
    { icon: BotMessageSquare, text: t('points.ai') },
  ] as const;
  return (
    <Card className="relative overflow-hidden border-brand-soft bg-brand-faint" aria-labelledby="about-relay">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 md:max-w-xl">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9" />
            <div>
              <h2 id="about-relay" className="text-panel text-fg">
                {t('title')}
              </h2>
              <p className="text-meta text-brand-text">{t('badge')}</p>
            </div>
          </div>
          <p className="mt-3 text-body text-fg">{t('promise')}</p>
          <p className="mt-1 text-body font-semibold text-fg">{t('ai')}</p>
          <Button asChild variant="primary" className="mt-4">
            <Link href="/?tab=radar">
              {t('tryRadar')}
              <Icon icon={ChevronRight} flipInRtl />
            </Link>
          </Button>
        </div>
        <ul className="grid gap-3 md:max-w-sm">
          {points.map((p) => (
            <li key={p.text} className="flex items-start gap-3 text-body text-fg-2">
              <span
                aria-hidden
                className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-surface text-brand-text"
              >
                <p.icon className="size-4" />
              </span>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('dismiss')}
        className="absolute end-2 top-2 inline-flex size-11 items-center justify-center rounded-control text-fg-2 hover:bg-surface hover:text-fg sm:size-9"
      >
        <X aria-hidden className="size-4" />
        <span className="sr-only">{c('actions.close')}</span>
      </button>
    </Card>
  );
}
