'use client';
// TestPanel (components.md §6): runs a simulated lead through the pure lead-engine domain using the
// CURRENT team state and the DRAFT rule; nothing is written. Shows who gets the lead and when
// (configured time, and the real wait under the active time-warp).
import type { SimulateResponse, SimulateStep } from '@relay/contracts/api/automations';
import { useMutation } from '@tanstack/react-query';
import { ArrowDownToLine, FlaskConical, Siren, UserRound } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Ltr } from '@/components/relay/ltr';
import { api } from '@/lib/api-client';
import { useDuration } from './parts';
import { toInput, validate, type Draft } from './policy-model';
import { useErrorToast, useTimeWarp } from './use-automations';

const SKIP_KEYS = new Set([
  'inactive',
  'not_member',
  'on_leave',
  'offline',
  'busy',
  'at_capacity',
  'no_skill',
  'already_tried',
  'current_owner',
  'no_target',
  'unknown_user',
]);

export function TestPanel({ teamId, draft }: { teamId: string; draft: Draft }) {
  const t = useTranslations('automations.test');
  const dur = useDuration();
  const reduce = useReducedMotion();
  const warp = useTimeWarp();
  const onError = useErrorToast();
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const invalid = validate(draft).length > 0;
  const run = useMutation({
    mutationFn: () =>
      api.automations.simulate({ teamId, repeatCount: draft.repeatCount, levels: toInput(draft) }),
    onSuccess: setResult,
    onError,
  });
  const factor = warp.data?.multiplier ?? 1;

  const stepTitle = (s: SimulateStep) => {
    const who = s.toName ?? t('nobody');
    switch (s.kind) {
      case 'assigned':
        return s.custody === 'handler' ? t('step.assigned', { who }) : t('step.heldBy', { who });
      case 'escalated':
        return t('step.escalated', { who, from: s.fromName ?? '' });
      case 'overdue':
        return t('step.overdue', { who });
      case 'critical':
        return t('step.critical', { who });
    }
  };

  return (
    <Card aria-labelledby="test-title">
      <CardHeader
        titleId="test-title"
        icon={<FlaskConical aria-hidden />}
        title={t('title')}
        description={t('description')}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" loading={run.isPending} disabled={invalid} onClick={() => run.mutate()}>
          <ArrowDownToLine aria-hidden className="size-4" />
          {result ? t('rerun') : t('run')}
        </Button>
        {invalid ? <span className="text-meta text-danger">{t('fixFirst')}</span> : null}
      </div>

      <div aria-live="polite" className="mt-4">
        {run.isPending && !result ? <p className="text-meta text-fg-2">{t('running')}</p> : null}
        {result ? (
          <>
            <ol className="relative space-y-4 ps-8 before:absolute before:inset-y-2 before:start-3 before:w-px before:bg-line-strong">
              {result.steps.map((s, i) => (
                <motion.li
                  key={`${i}-${s.kind}-${s.toUserId}`}
                  initial={reduce ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={reduce ? { duration: 0 } : { delay: i * 0.08, duration: 0.2 }}
                  className="relative"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute -start-8 top-0.5 flex size-6 items-center justify-center rounded-chip border bg-surface',
                      s.kind === 'critical'
                        ? 'border-danger text-danger'
                        : s.kind === 'assigned'
                          ? 'border-line-strong text-fg-2'
                          : 'border-warning text-warning',
                    )}
                  >
                    {s.kind === 'critical' ? (
                      <Siren className="size-3.5" />
                    ) : (
                      <UserRound className="size-3.5" />
                    )}
                  </span>
                  <p className="text-meta text-fg-2">
                    {s.atSeconds === 0 ? (
                      t('at.start')
                    ) : (
                      <>
                        {t('at.after')} <Ltr className="tabular font-medium text-fg">{dur(s.atSeconds)}</Ltr>
                        {factor > 1 ? (
                          <span>
                            {' '}
                            ({t('at.real')}{' '}
                            <Ltr className="tabular">
                              {dur(Math.max(1, Math.round(s.atSeconds / factor)))}
                            </Ltr>
                            )
                          </span>
                        ) : null}
                      </>
                    )}
                  </p>
                  <p className="text-body font-medium text-fg">{stepTitle(s)}</p>
                  {s.skipped.length ? (
                    <p className="mt-1 text-meta text-fg-2">
                      {t('skipped', {
                        list: s.skipped
                          .map((k) =>
                            t('skippedItem', {
                              name: k.name ?? t('nobody'),
                              reason: SKIP_KEYS.has(k.reason) ? t(`skip.${k.reason}`) : k.reason,
                            }),
                          )
                          .join(', '),
                      })}
                    </p>
                  ) : null}
                  {s.waitSeconds && s.kind !== 'critical' ? (
                    <p className="mt-1 text-meta text-fg-2">{t('waits', { time: dur(s.waitSeconds) })}</p>
                  ) : null}
                </motion.li>
              ))}
            </ol>
            <p className="mt-4 rounded-control bg-surface-muted p-3 text-meta text-fg-2">
              {t('summary', { time: dur(Math.max(1, result.totalSeconds)) })}
            </p>
          </>
        ) : (
          !run.isPending && <p className="text-meta text-fg-2">{t('empty')}</p>
        )}
      </div>
    </Card>
  );
}
