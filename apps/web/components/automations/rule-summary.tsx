'use client';
// RuleSummary (components.md §6): the guided editor. A readable sentence chain on top, an ordered list of
// editable levels below (target + wait per level), repeat count and the fixed end-of-chain behaviour.
// This IS the P0 "basic settings form" (T-124). Keyboard: every control is a native input/select/button.
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BellRing,
  Plus,
  Repeat,
  Trash2,
  UserRound,
  UsersRound,
  Siren,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/relay/form-field';
import { DurationField, NativeSelect, useDuration } from './parts';
import { MAX_LEVELS, nextUid, validate, type Draft, type DraftLevel } from './policy-model';
import type { Person } from './use-automations';

const TARGET_ICON = {
  next_eligible: UsersRound,
  user: UserRound,
  team_backup: UserRound,
  team_manager: UserRound,
} as const;

export function useTargetLabel(people: Person[], names: { backup?: string; manager?: string }) {
  const t = useTranslations('automations.policy.target');
  return (l: Pick<DraftLevel, 'targetType' | 'targetUserId'>): string => {
    switch (l.targetType) {
      case 'next_eligible':
        return t('next_eligible');
      case 'team_backup':
        return names.backup ? t('team_backup_named', { name: names.backup }) : t('team_backup');
      case 'team_manager':
        return names.manager ? t('team_manager_named', { name: names.manager }) : t('team_manager');
      case 'user':
        return people.find((p) => p.id === l.targetUserId)?.name ?? t('user');
    }
  };
}

function Chip({
  children,
  tone = 'neutral',
  icon,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
  icon?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-chip border px-3 py-1 text-meta font-medium [&_svg]:size-3.5',
        tone === 'neutral' && 'border-line bg-surface text-fg',
        tone === 'warning' && 'border-warning/40 bg-warning-surface text-fg',
        tone === 'danger' && 'border-danger/40 bg-danger-surface text-fg',
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const Arrow = () => <ArrowRight aria-hidden className="size-4 shrink-0 text-fg-muted rtl:rotate-180" />;

export function RuleSummary({
  draft,
  onChange,
  people,
  names,
  selected,
  onSelect,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  people: Person[];
  names: { backup?: string; manager?: string };
  selected: number | null;
  onSelect: (i: number | null) => void;
}) {
  const t = useTranslations('automations.policy');
  const dur = useDuration();
  const reduce = useReducedMotion();
  const label = useTargetLabel(people, names);
  const errors = validate(draft);
  const err = (i: number, f: 'timeout' | 'user') => errors.some((e) => e.level === i && e.field === f);

  const setLevel = (i: number, patch: Partial<DraftLevel>) =>
    onChange({ ...draft, levels: draft.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const move = (i: number, d: -1 | 1) => {
    const levels = [...draft.levels];
    const j = i + d;
    if (j < 1 || j >= levels.length) return; // level 1 is the first assignment and stays first
    [levels[i], levels[j]] = [levels[j]!, levels[i]!];
    onChange({ ...draft, levels });
    onSelect(j);
  };
  const remove = (i: number) => {
    onChange({ ...draft, levels: draft.levels.filter((_, j) => j !== i) });
    onSelect(null);
  };
  const add = () => {
    const last = draft.levels.at(-1);
    onChange({
      ...draft,
      levels: [
        ...draft.levels,
        {
          uid: nextUid(),
          targetType: 'next_eligible',
          targetUserId: null,
          timeoutSeconds: last?.timeoutSeconds ?? 120,
        },
      ],
    });
    onSelect(draft.levels.length);
  };

  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 36 };

  return (
    <div className="space-y-5">
      {/* Sentence chain */}
      <section aria-label={t('chain.label')} className="rounded-card border border-line bg-surface-muted p-4">
        <p className="mb-3 text-eyebrow text-fg-muted">{t('chain.title')}</p>
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <li>
            <Chip icon={<Zap aria-hidden />}>{t('chain.arrives')}</Chip>
          </li>
          {draft.levels.map((l, i) => (
            <Fragment key={l.uid}>
              <li aria-hidden>
                <Arrow />
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onSelect(selected === i ? null : i)}
                  aria-pressed={selected === i}
                  className={cn(
                    'rounded-chip focus-visible:outline-2',
                    selected === i && 'ring-2 ring-brand ring-offset-2 ring-offset-surface-muted',
                  )}
                >
                  <Chip icon={<UsersRound aria-hidden />}>
                    {i === 0 ? t('chain.assign', { who: label(l) }) : t('chain.then', { who: label(l) })}
                  </Chip>
                </button>
              </li>
              <li aria-hidden>
                <Arrow />
              </li>
              <li>
                <Chip tone="warning" icon={<BellRing aria-hidden />}>
                  {t('chain.wait', { time: dur(l.timeoutSeconds) })}
                </Chip>
              </li>
            </Fragment>
          ))}
          {draft.repeatCount > 1 ? (
            <>
              <li aria-hidden>
                <Arrow />
              </li>
              <li>
                <Chip icon={<Repeat aria-hidden />}>{t('chain.repeat', { count: draft.repeatCount })}</Chip>
              </li>
            </>
          ) : null}
          <li aria-hidden>
            <Arrow />
          </li>
          <li>
            <Chip tone="danger" icon={<Siren aria-hidden />}>
              {t('chain.critical')}
            </Chip>
          </li>
        </ol>
      </section>

      {/* Levels */}
      <ol className="space-y-3">
        <AnimatePresence initial={false}>
          {draft.levels.map((l, i) => {
            const Icon = TARGET_ICON[l.targetType];
            return (
              <motion.li
                key={l.uid}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                transition={spring}
                className={cn(
                  'rounded-card border bg-surface p-4',
                  selected === i ? 'border-brand ring-1 ring-brand' : 'border-line',
                )}
                onFocusCapture={() => onSelect(i)}
              >
                <div className="mb-3 flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-8 items-center justify-center rounded-chip bg-surface-muted text-meta font-semibold tabular text-fg"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-panel text-fg">
                      <Icon aria-hidden className="size-4 text-fg-2" />
                      {i === 0 ? t('level.first') : t('level.n', { n: i + 1 })}
                    </p>
                    {i === 0 ? <p className="text-meta text-fg-2">{t('level.firstHint')}</p> : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('level.moveUp', { n: i + 1 })}
                      disabled={i < 2}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp aria-hidden className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('level.moveDown', { n: i + 1 })}
                      disabled={i === 0 || i === draft.levels.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown aria-hidden className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('level.remove', { n: i + 1 })}
                      disabled={draft.levels.length <= 1}
                      onClick={() => remove(i)}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField
                    label={i === 0 ? t('level.assignTo') : t('level.escalateTo')}
                    error={err(i, 'user') ? t('level.userRequired') : undefined}
                  >
                    {(p) => (
                      <div className="space-y-2">
                        <NativeSelect
                          {...p}
                          value={l.targetType}
                          disabled={i === 0}
                          onChange={(e) =>
                            setLevel(i, {
                              targetType: e.target.value as DraftLevel['targetType'],
                              targetUserId: e.target.value === 'user' ? (people[0]?.id ?? null) : null,
                            })
                          }
                        >
                          <option value="next_eligible">{t('target.next_eligible')}</option>
                          <option value="team_backup">{t('target.team_backup')}</option>
                          <option value="team_manager">{t('target.team_manager')}</option>
                          <option value="user">{t('target.user')}</option>
                        </NativeSelect>
                        {l.targetType === 'user' ? (
                          <NativeSelect
                            aria-label={t('level.pickUser')}
                            value={l.targetUserId ?? ''}
                            onChange={(e) => setLevel(i, { targetUserId: e.target.value || null })}
                          >
                            <option value="">{t('level.pickUser')}</option>
                            {people.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </NativeSelect>
                        ) : null}
                      </div>
                    )}
                  </FormField>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-meta font-medium text-fg">
                      {i === 0 ? t('level.firstWindow') : t('level.waitFor')}
                    </span>
                    <DurationField
                      label={t('level.waitAria', { n: i + 1 })}
                      value={l.timeoutSeconds}
                      invalid={err(i, 'timeout')}
                      onChange={(s) => setLevel(i, { timeoutSeconds: s })}
                    />
                    {err(i, 'timeout') ? (
                      <p role="alert" className="text-meta text-danger">
                        {t('level.timeoutInvalid')}
                      </p>
                    ) : null}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={add} disabled={draft.levels.length >= MAX_LEVELS}>
          <Plus aria-hidden className="size-4" />
          {t('level.add')}
        </Button>
        {draft.levels.length >= MAX_LEVELS ? (
          <span className="text-meta text-fg-2">{t('level.max', { max: MAX_LEVELS })}</span>
        ) : null}
      </div>

      <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
        <FormField label={t('repeat.label')} helper={t('repeat.helper')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              dir="ltr"
              min={1}
              max={10}
              className="w-24 tabular"
              value={draft.repeatCount}
              onChange={(e) =>
                onChange({
                  ...draft,
                  repeatCount: Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1))),
                })
              }
            />
          )}
        </FormField>
        <div className="flex flex-col gap-1.5">
          <span className="text-meta font-medium text-fg">{t('end.label')}</span>
          <p className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-surface p-3 text-meta text-fg">
            <Siren aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            {t('end.body')}
          </p>
          <p className="text-meta text-fg-2">{t('hours.note')}</p>
        </div>
      </div>
    </div>
  );
}
