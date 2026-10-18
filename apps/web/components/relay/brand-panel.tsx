// BrandPanel: the selling half of /login and /signup. Wordmark, tagline, the pitch line, three proof points and a
// decorative "handoff" illustration (a lead escalating from one owner to the next). Server-renderable.
// The illustration is aria-hidden and carries no real data; its clock is frozen.
import { ArrowDown, BotMessageSquare, RadioTower, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/ui/cn';
import { Wordmark } from './brand';
import { CountdownRing } from './countdown-ring';
import { BrandGlass } from './brand-glass';
import { Avatar } from './owner-chip';

const PROOFS = [
  { key: 'owner', icon: UserCheck },
  { key: 'escalate', icon: RadioTower },
  { key: 'ai', icon: BotMessageSquare },
] as const;

function HandoffArt() {
  const t = useTranslations('common');
  return (
    <div aria-hidden className="relative mx-auto hidden w-full max-w-xs flex-col items-stretch gap-2 lg:flex">
      <div className="rounded-card border border-line bg-surface/85 p-3 shadow-pop backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Avatar name={t('brand.demo.from')} className="size-10 text-button" />
          <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">
            {t('brand.demo.from')}
          </span>
          <CountdownRing endsAt={20_000} windowMs={300_000} nowMs={0} size={40} showLabel={false} />
        </div>
      </div>
      <div className="flex justify-center">
        <span className="flex size-9 items-center justify-center rounded-chip bg-brand text-on-brand shadow-card">
          <ArrowDown className="size-4" />
        </span>
      </div>
      <div className="rounded-card border border-line bg-surface/85 p-3 shadow-pop backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Avatar name={t('brand.demo.to')} className="size-10 text-button" />
          <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{t('brand.demo.to')}</span>
          <CountdownRing endsAt={252_000} windowMs={300_000} nowMs={0} size={40} showLabel={false} />
        </div>
      </div>
    </div>
  );
}

export function BrandPanel({ className }: { className?: string }) {
  const t = useTranslations('common');
  return (
    <aside
      className={cn(
        'relative isolate flex flex-col gap-6 overflow-hidden bg-brand-faint px-6 py-6 sm:px-10 lg:min-h-dvh lg:justify-between lg:gap-10 lg:px-14 lg:py-10',
        className,
      )}
    >
      <BrandGlass className="absolute inset-0 -z-10 h-full w-full opacity-90" />
      <div>
        <Wordmark />
      </div>

      <div className="max-w-xl space-y-4">
        <p className="text-hero text-fg">{t('tagline')}</p>
        <p className="text-panel font-normal text-fg-2 md:text-[19px]">{t('brand.pitch')}</p>
      </div>

      <HandoffArt />

      <section aria-label={t('brand.proofTitle')} className="max-w-xl">
        <ul className="grid gap-3 lg:gap-4">
          {PROOFS.map(({ key, icon: Glyph }) => (
            <li key={key} className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-control bg-surface text-brand-text shadow-card"
              >
                <Glyph className="size-[18px]" />
              </span>
              <div>
                <p className="text-body font-semibold text-fg">{t(`brand.proof.${key}.title`)}</p>
                <p className="hidden text-meta text-fg-2 sm:block">{t(`brand.proof.${key}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
