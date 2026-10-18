'use client';
// Kitchen sink: motion kit + Lottie budget (Lane D3, T-228). Every demo has a Replay control so reviewers can
// see the animation on demand, and each respects prefers-reduced-motion (final state / still rest frame).
import { MousePointerClick, PartyPopper, Plus, RotateCcw, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/relay/empty-state';
import { LOTTIE_META, LOTTIE_NAMES, RelayLottie, type LottieName } from '@/components/relay/lottie';
import {
  Collapse,
  CountUp,
  FadeIn,
  LayoutGroup,
  Highlight,
  PopIn,
  Presence,
  Pressable,
  Stagger,
  StaggerItem,
} from '@/components/relay/motion';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { toast } from '@/components/ui/toaster';
import { useFormat } from '@/lib/format/use-format';

export function MotionSection() {
  const t = useTranslations('ui.kitchen');
  const f = useFormat();
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<number[]>([1, 2]);
  const [tab, setTab] = useState<'day' | 'week' | 'month'>('week');
  const [replay, setReplay] = useState<Record<string, number>>({});

  return (
    <div className="space-y-4">
      <p className="text-body text-fg-2">{t('intro')}</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            icon={<Sparkles />}
            title={t('countUp')}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setRun((n) => n + 1)}>
                <Icon icon={RotateCcw} />
                {t('replay')}
              </Button>
            }
          />
          <div key={run} className="mt-5 space-y-2">
            <p className="text-kpi text-fg">
              <CountUp value={1_250_000} format={(n) => f.money(Math.round(n) * 100, 'PKR')} />
            </p>
            <p className="text-meta text-fg-muted">
              <CountUp value={42} /> {t('leadsToday')} ·{' '}
              <CountUp value={0.873} format={(n) => f.percent(n, 1)} />
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<MousePointerClick />}
            title={t('interaction')}
            description={t('interactionHint')}
          />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Pressable>
              <Button variant="primary">{t('press')}</Button>
            </Pressable>
            <Pressable lift={2} scale={0.98}>
              <Button variant="secondary">{t('lift')}</Button>
            </Pressable>
          </div>
          <LayoutGroup id="ks-seg">
            <div
              role="tablist"
              aria-label={t('segmented')}
              className="mt-4 inline-flex gap-1 rounded-control bg-surface-muted p-1"
            >
              {(['day', 'week', 'month'] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn(
                    'relative isolate min-h-9 rounded-control px-4 text-button',
                    tab === k ? 'text-fg' : 'text-fg-2 hover:text-fg',
                  )}
                >
                  {tab === k ? (
                    <Highlight layoutId="ks-seg-pill" className="rounded-control bg-surface shadow-card" />
                  ) : null}
                  {t(`seg.${k}`)}
                </button>
              ))}
            </div>
          </LayoutGroup>
        </Card>

        <Card>
          <CardHeader
            icon={<Plus />}
            title={t('presence')}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setItems((x) => [...x, (x.at(-1) ?? 0) + 1])}>
                <Icon icon={Plus} />
                {t('add')}
              </Button>
            }
          />
          <div className="mt-4 space-y-2">
            <Presence initial={false}>
              {items.slice(-4).map((i) => (
                <PopIn key={i} from="end">
                  <div className="flex items-center justify-between rounded-control border border-line bg-surface-muted/60 px-3 py-2 text-body">
                    {t('item', { n: i })}
                    <button
                      type="button"
                      className="rounded-control px-2 text-meta text-fg-2 hover:text-fg"
                      onClick={() => setItems((x) => x.filter((y) => y !== i))}
                    >
                      {t('remove')}
                    </button>
                  </div>
                </PopIn>
              ))}
            </Presence>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? t('collapse') : t('expand')}
          </Button>
          <Collapse open={open}>
            <p className="pt-3 text-meta text-fg-2">{t('collapseBody')}</p>
          </Collapse>
        </Card>
      </div>

      <Stagger key={`s-${run}`} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[t('stagger1'), t('stagger2'), t('stagger3'), t('stagger4')].map((s) => (
          <StaggerItem
            key={s}
            className="rounded-card border border-line bg-surface p-4 text-body shadow-card"
          >
            {s}
          </StaggerItem>
        ))}
      </Stagger>

      <Card>
        <CardHeader
          icon={<PartyPopper />}
          title={t('lottie')}
          description={t('lottieHint', { count: LOTTIE_NAMES.length })}
        />
        <ul className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {LOTTIE_NAMES.map((name: LottieName) => (
            <li
              key={name}
              className="flex flex-col items-center gap-2 rounded-card border border-line bg-surface-muted/50 p-4"
            >
              <RelayLottie key={replay[name] ?? 0} name={name} className="size-24" />
              <code dir="ltr" className="text-meta text-fg">
                {name}
              </code>
              <span className="text-meta text-fg-muted">
                {LOTTIE_META[name].loop ? t('loops') : t('oneShot')}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReplay((r) => ({ ...r, [name]: (r[name] ?? 0) + 1 }))}
              >
                <Icon icon={RotateCcw} />
                {t('replay')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <EmptyState
            animation="celebrate"
            headingLevel={3}
            title={t('emptyTitle')}
            description={t('emptyBody')}
            action={
              <Button variant="secondary" onClick={() => toast.success(t('toast'))}>
                {t('toastButton')}
              </Button>
            }
          />
        </Card>
        <Card>
          <EmptyState
            animation="handoff"
            headingLevel={3}
            title={t('handoffTitle')}
            description={t('handoffBody')}
          />
        </Card>
      </div>
      <FadeIn key={`f-${run}`} className="text-meta text-fg-muted">
        {t('reduced')}
      </FadeIn>
    </div>
  );
}
