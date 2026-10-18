'use client';
// Describe-your-business onboarding (T-218, F9.3): describe (or pick a template) -> AI proposal -> editable
// review -> confirm applies everything in ONE transaction. Nothing is applied before confirm. Built-in
// templates work with AI off.
import type {
  OnboardingApplyResponse,
  OnboardingProposal,
  OnboardingTemplateDto,
} from '@relay/contracts/api/crm-extras';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, Check, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { StatusBadge } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { Link } from '@/lib/i18n/navigation';
import { ErrorNote, useLoad } from './ui';

type Step = 'describe' | 'review' | 'done';
const STEPS: Step[] = ['describe', 'review', 'done'];

export function OnboardingWizard() {
  const t = useTranslations('crm.onboarding');
  const locale = useLocale();
  const reduce = useReducedMotion();
  const templates = useLoad(() => api.crm.onboarding.templates(), 'onboarding:templates');
  const [step, setStep] = useState<Step>('describe');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [proposal, setProposal] = useState<OnboardingProposal | null>(null);
  const [source, setSource] = useState<'ai' | 'template'>('template');
  const [note, setNote] = useState<string | null>(null);
  const [makeDefault, setMakeDefault] = useState(true);
  const [result, setResult] = useState<OnboardingApplyResponse | null>(null);

  async function propose(
    input: { description: string } | { templateId: OnboardingTemplateDto['id'] },
    key: string,
  ) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const r = await api.crm.onboarding.propose(input);
      if (!r.proposal) {
        setNote('unavailable');
        return;
      }
      setProposal(r.proposal);
      setSource(r.source === 'ai' ? 'ai' : 'template');
      if (r.source === 'template' && 'description' in input)
        setNote(r.aiError === 'disabled' ? 'aiOff' : 'aiFailed');
      setStep('review');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!proposal) return;
    setBusy('apply');
    setError(null);
    try {
      setResult(await api.crm.onboarding.apply({ proposal, makeDefault }));
      setStep('done');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const update = (fn: (p: OnboardingProposal) => OnboardingProposal) =>
    setProposal((p) => (p ? fn(structuredClone(p)) : p));
  const idx = STEPS.indexOf(step);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-page text-fg">{t('title')}</h1>
        <p className="text-body text-fg-2">{t('subtitle')}</p>
      </header>

      <ol className="flex items-center gap-2" aria-label={t('stepsLabel')}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className="flex flex-1 items-center gap-2"
            aria-current={i === idx ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-chip text-meta font-semibold',
                i < idx && 'bg-success text-on-success',
                i === idx && 'bg-brand-strong text-on-brand-strong',
                i > idx && 'bg-surface-muted text-fg-muted',
              )}
            >
              {i < idx ? <Check aria-hidden className="size-4" /> : i + 1}
            </span>
            <span className={cn('text-meta', i === idx ? 'font-semibold text-fg' : 'text-fg-2')}>
              {t(`steps.${s}`)}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden className="relative h-0.5 flex-1 overflow-hidden rounded-chip bg-line">
                <motion.span
                  className="absolute inset-y-0 start-0 bg-brand-strong"
                  initial={false}
                  animate={{ width: i < idx ? '100%' : '0%' }}
                  transition={{ duration: reduce ? 0 : 0.35 }}
                />
              </span>
            )}
          </li>
        ))}
      </ol>

      <ErrorNote error={error} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {step === 'describe' && (
            <div className="space-y-5">
              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles aria-hidden className="size-5 text-ai" />
                  <h2 className="text-panel text-fg">{t('describe.heading')}</h2>
                </div>
                <label htmlFor="biz" className="sr-only">
                  {t('describe.heading')}
                </label>
                <Textarea
                  id="biz"
                  value={text}
                  maxLength={600}
                  rows={4}
                  placeholder={t('describe.placeholder')}
                  onChange={(e) => setText(e.target.value)}
                />
                {templates.data && !templates.data.aiEnabled && (
                  <StatusBadge tone="neutral">{t('describe.aiOff')}</StatusBadge>
                )}
                {note === 'unavailable' && (
                  <p role="status" className="text-meta text-warning">
                    {t('describe.unavailable')}
                  </p>
                )}
                <Button
                  variant="primary"
                  loading={busy === 'ai'}
                  disabled={text.trim().length < 3}
                  onClick={() => propose({ description: text.trim() }, 'ai')}
                >
                  <Wand2 aria-hidden className="size-4" />{' '}
                  {busy === 'ai' ? t('describe.working') : t('describe.go')}
                </Button>
              </Card>

              <div>
                <p className="mb-3 text-meta font-medium text-fg-2">{t('describe.orTemplate')}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {templates.data?.items.map((tp, i) => (
                    <motion.button
                      key={tp.id}
                      type="button"
                      initial={reduce ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06 }}
                      whileHover={reduce ? undefined : { y: -2 }}
                      disabled={busy !== null}
                      onClick={() => propose({ templateId: tp.id }, tp.id)}
                      className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 text-start shadow-card transition-colors hover:border-brand-strong disabled:opacity-60"
                    >
                      <span className="text-panel text-fg">{locale === 'ur' ? tp.name.ur : tp.name.en}</span>
                      <span className="text-meta text-fg-2">
                        {locale === 'ur' ? tp.description.ur : tp.description.en}
                      </span>
                      <span className="text-meta text-brand-text">
                        {busy === tp.id ? t('describe.working') : t('describe.useTemplate')}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 'review' && proposal && (
            <Card className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-panel text-fg">{t('review.heading')}</h2>
                  <p className="text-meta text-fg-2">{t('review.intro')}</p>
                </div>
                {source === 'ai' ? (
                  <StatusBadge tone="info" icon={Sparkles}>
                    {t('review.fromAi')}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">{t('review.fromTemplate')}</StatusBadge>
                )}
              </div>
              {note && note !== 'unavailable' && (
                <p role="status" className="text-meta text-fg-2">
                  {t(`review.${note}`)}
                </p>
              )}
              <p className="rounded-control bg-surface-muted p-3 text-body text-fg">
                {proposal.businessSummary}
              </p>

              {proposal.pipelines.map((pl, pi) => (
                <section key={pi} className="space-y-2" aria-label={pl.name}>
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={t('review.pipelineName')}
                      value={pl.name}
                      onChange={(e) => update((p) => ((p.pipelines[pi]!.name = e.target.value), p))}
                    />
                  </div>
                  <ol className="space-y-2">
                    {pl.stages.map((st, si) => (
                      <li
                        key={si}
                        className="flex flex-wrap items-center gap-2 rounded-control border border-line p-2"
                      >
                        <span className="w-6 text-center text-meta tabular-nums text-fg-muted">{si + 1}</span>
                        <Input
                          className="min-w-40 flex-1"
                          aria-label={t('review.stageName')}
                          value={st.name}
                          onChange={(e) =>
                            update((p) => ((p.pipelines[pi]!.stages[si]!.name = e.target.value), p))
                          }
                        />
                        <StatusBadge
                          tone={st.kind === 'won' ? 'success' : st.kind === 'lost' ? 'danger' : 'neutral'}
                        >
                          {t(`review.kind.${st.kind}`)}
                        </StatusBadge>
                        {st.rotDays ? (
                          <StatusBadge tone="neutral">{t('review.rot', { days: st.rotDays })}</StatusBadge>
                        ) : null}
                        {st.requiredFieldKeys.length > 0 && (
                          <span className="text-meta text-fg-2">
                            {t('review.requires', { fields: st.requiredFieldKeys.join(', ') })}
                          </span>
                        )}
                        {pl.stages.length > 2 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t('review.remove')}
                            onClick={() => update((p) => (p.pipelines[pi]!.stages.splice(si, 1), p))}
                          >
                            <Trash2 aria-hidden className="size-4" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}

              <section aria-label={t('review.fields')} className="space-y-2">
                <h3 className="text-panel text-fg">{t('review.fields')}</h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {proposal.fields.map((f, fi) => (
                    <li
                      key={fi}
                      className="flex items-center justify-between gap-2 rounded-control border border-line p-2"
                    >
                      <span className="min-w-0 text-body text-fg">
                        {locale === 'ur' ? f.label.ur : f.label.en}
                        <span className="block text-meta text-fg-muted">
                          {t(`review.entity.${f.entity}`)} · {f.type}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('review.remove')}
                        onClick={() =>
                          update((p) => {
                            const key = p.fields[fi]!.key;
                            p.fields.splice(fi, 1);
                            for (const pl of p.pipelines)
                              for (const s of pl.stages)
                                s.requiredFieldKeys = s.requiredFieldKeys.filter((k) => k !== key);
                            return p;
                          })
                        }
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-label={t('review.tags')} className="space-y-2">
                <h3 className="text-panel text-fg">{t('review.tags')}</h3>
                <div className="flex flex-wrap gap-2">
                  {proposal.tags.map((tag, ti) => (
                    <span
                      key={ti}
                      className="inline-flex items-center gap-1 rounded-chip bg-neutral-surface px-3 py-1 text-meta text-fg"
                    >
                      {tag}
                      <button
                        type="button"
                        aria-label={t('review.remove')}
                        onClick={() => update((p) => (p.tags.splice(ti, 1), p))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </section>

              <label className="flex items-center gap-2 text-body text-fg">
                <input
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(e) => setMakeDefault(e.target.checked)}
                />
                {t('review.makeDefault')}
              </label>

              <footer className="flex flex-wrap justify-between gap-2">
                <Button onClick={() => setStep('describe')}>
                  <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" /> {t('review.back')}
                </Button>
                <Button variant="primary" loading={busy === 'apply'} onClick={apply}>
                  {t('review.confirm')}
                </Button>
              </footer>
            </Card>
          )}

          {step === 'done' && result && (
            <Card className="flex flex-col items-center gap-4 py-10 text-center">
              <motion.span
                aria-hidden
                initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                className="flex size-16 items-center justify-center rounded-chip bg-success-surface text-success"
              >
                <Check className="size-8" />
              </motion.span>
              <h2 className="text-page text-fg">{t('done.title')}</h2>
              <p role="status" className="text-body text-fg-2">
                {t('done.body', {
                  pipelines: result.created.pipelines,
                  stages: result.created.stages,
                  fields: result.created.fields,
                  tags: result.created.tags,
                })}
              </p>
              {result.skipped.pipelines + result.skipped.fields + result.skipped.tags > 0 && (
                <p className="text-meta text-fg-muted">
                  {t('done.skipped', {
                    count: result.skipped.pipelines + result.skipped.fields + result.skipped.tags,
                  })}
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild variant="primary">
                  <Link href="/pipeline">{t('done.pipeline')}</Link>
                </Button>
                <Button asChild>
                  <Link href="/settings/fields">{t('done.fields')}</Link>
                </Button>
              </div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
