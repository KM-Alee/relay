'use client';
// Judge Console (T-209; F10.1; screens.md §8): scenario cards grouped by rubric criterion with
// description · Run · expected vs actual · pass/fail badge · evidence links. Runs hit the real services.
import type { JudgeRunResult, JudgeScenarioDto } from '@relay/contracts/api/judge';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, ExternalLink, Gavel, Hourglass, Play, PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState } from 'react';
import { EmptyState, Ltr, PageHeader, StatusBadge, type StatusTone } from '@/components/relay';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { api, localizeError } from '@/lib/api-client';
import { useFormat } from '@/lib/format/use-format';
import { Link } from '@/lib/i18n/navigation';

type RunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: JudgeRunResult }
  | { phase: 'error'; message: string };

const TONE: Record<'pass' | 'fail' | 'pending' | 'running' | 'idle', StatusTone> = {
  pass: 'success',
  fail: 'danger',
  pending: 'info',
  running: 'info',
  idle: 'neutral',
};

export function JudgeView() {
  const t = useTranslations('judge');
  const te = useTranslations();
  const q = useQuery({ queryKey: ['judge', 'list'], queryFn: () => api.judge.list(), retry: false });
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [all, setAll] = useState(false);
  const busy = useRef(new Set<string>());

  const runOne = useCallback(
    async (id: string) => {
      if (busy.current.has(id)) return;
      busy.current.add(id);
      setRuns((r) => ({ ...r, [id]: { phase: 'running' } }));
      try {
        const result = await api.judge.run({ params: { scenario: id } });
        setRuns((r) => ({ ...r, [id]: { phase: 'done', result } }));
      } catch (err) {
        setRuns((r) => ({ ...r, [id]: { phase: 'error', message: localizeError(err, (k, v) => te(k, v)) } }));
      } finally {
        busy.current.delete(id);
      }
    },
    [te],
  );

  const scenarios = useMemo(() => q.data?.scenarios ?? [], [q.data]);
  const runAll = async () => {
    setAll(true);
    // Sequential on purpose: some scenarios (provider outage) change shared state for a moment.
    for (const s of scenarios) await runOne(s.id);
    setAll(false);
  };

  const groups = useMemo(() => {
    const m = new Map<number, JudgeScenarioDto[]>();
    for (const s of scenarios) m.set(s.criterion, [...(m.get(s.criterion) ?? []), s]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [scenarios]);

  const counts = { pass: 0, fail: 0, pending: 0, idle: 0 };
  for (const s of scenarios) {
    const r = runs[s.id];
    if (r?.phase === 'done') counts[r.result.status]++;
    else if (r?.phase === 'error') counts.fail++;
    else counts.idle++;
  }

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button variant="primary" loading={all} disabled={!scenarios.length} onClick={() => void runAll()}>
            <Icon icon={PlayCircle} />
            {all ? t('running') : t('runAll')}
          </Button>
        }
      />
      <p className="mb-4 text-meta text-fg-muted">{t('demoNote')}</p>

      {q.isPending ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-card" />
          ))}
        </div>
      ) : q.isError ? (
        <EmptyState
          title={t('loadFailed')}
          description={localizeError(q.error, (k, v) => te(k, v))}
          action={
            <Button onClick={() => void q.refetch()} variant="secondary">
              {t('retry')}
            </Button>
          }
        />
      ) : (
        <>
          <p className="mb-6 text-body text-fg-2" aria-live="polite">
            {t('summary', counts)}
          </p>
          <div className="flex flex-col gap-8">
            {groups.map(([criterion, items]) => (
              <section key={criterion} aria-labelledby={`crit-${criterion}`}>
                <h2 id={`crit-${criterion}`} className="mb-3 flex items-center gap-2 text-panel text-fg">
                  <span className="inline-flex size-7 items-center justify-center rounded-chip bg-surface-muted text-meta font-bold text-fg-2">
                    <Ltr>{criterion}</Ltr>
                  </span>
                  {t(`criterion.${criterion}`)}
                </h2>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {items.map((s) => (
                    <ScenarioCard
                      key={s.id}
                      s={s}
                      state={runs[s.id] ?? { phase: 'idle' }}
                      onRun={() => void runOne(s.id)}
                      disabled={all}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ScenarioCard({
  s,
  state,
  onRun,
  disabled,
}: {
  s: JudgeScenarioDto;
  state: RunState;
  onRun: () => void;
  disabled: boolean;
}) {
  const t = useTranslations('judge');
  const f = useFormat();
  const key = state.phase === 'done' ? state.result.status : state.phase === 'error' ? 'fail' : state.phase;
  const icon =
    key === 'pass'
      ? CircleCheck
      : key === 'fail'
        ? CircleX
        : key === 'pending' || key === 'running'
          ? Hourglass
          : Gavel;
  const result = state.phase === 'done' ? state.result : null;
  const titleId = `sc-${s.id}`;

  return (
    <Card className="flex flex-col gap-4" aria-labelledby={titleId} role="group">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-panel text-fg">
            {t(`scenarios.${s.id}.title`)}
          </h3>
          <p className="mt-1 text-body text-fg-2">{t(`scenarios.${s.id}.description`)}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {s.reqs.map((r) => (
              <Ltr key={r}>
                <code className="rounded-chip bg-surface-muted px-1.5 py-0.5 text-meta text-fg-2">{r}</code>
              </Ltr>
            ))}
          </p>
        </div>
        <StatusBadge tone={TONE[key]} icon={icon} strong={key === 'pass' || key === 'fail'}>
          {t(`status.${key}`)}
        </StatusBadge>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Panel label={t('expected')} tone="neutral">
          <p className="text-body text-fg">{t(`scenarios.${s.id}.expected`)}</p>
        </Panel>
        <Panel
          label={t('actual')}
          tone={
            result
              ? result.status === 'pass'
                ? 'success'
                : result.status === 'fail'
                  ? 'danger'
                  : 'info'
              : state.phase === 'error'
                ? 'danger'
                : 'neutral'
          }
        >
          {state.phase === 'running' ? (
            <p className="text-body text-fg-2">{t('running')}</p>
          ) : state.phase === 'error' ? (
            <p role="alert" className="text-body text-danger">
              {t('runFailed')} {state.message}
            </p>
          ) : result ? (
            result.status === 'pending' ? (
              <p className="text-body text-fg-2">{t('pendingNote')}</p>
            ) : (
              <Ltr>
                <p className="break-words font-mono text-meta text-fg" dir="ltr">
                  {result.actual}
                </p>
              </Ltr>
            )
          ) : (
            <p className="text-body text-fg-muted">{t('idle')}</p>
          )}
        </Panel>
      </div>

      {result && result.steps.length ? (
        <details className="group rounded-control border border-line bg-surface-muted px-3 py-2">
          <summary className="cursor-pointer text-body font-medium text-fg-2">{t('steps')}</summary>
          <ol className="mt-2 flex flex-col gap-1.5">
            {result.steps.map((st, i) => (
              <li key={i} className="flex items-start gap-2 text-meta">
                <Icon
                  icon={st.ok ? CircleCheck : CircleX}
                  className={st.ok ? 'text-success' : 'text-danger'}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-fg">{st.label}</span>
                  {st.detail ? (
                    <Ltr>
                      <span className="block break-words font-mono text-fg-muted">{st.detail}</span>
                    </Ltr>
                  ) : null}
                </span>
                <Ltr>
                  <time className="shrink-0 text-fg-muted" dateTime={st.at}>
                    {f.time(st.at)}
                  </time>
                </Ltr>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-3">
        <Button
          variant={state.phase === 'idle' ? 'secondary' : 'ghost'}
          size="sm"
          loading={state.phase === 'running'}
          disabled={disabled}
          onClick={onRun}
        >
          <Icon icon={Play} />
          {state.phase === 'idle' ? t('run') : t('runAgain')}
        </Button>
        {result?.evidence.map((e) => (
          <Link
            key={e.key + e.href}
            href={e.href}
            className="inline-flex items-center gap-1 text-body text-brand-text hover:underline"
          >
            {t(`links.${e.key}`)}
            <Icon icon={ExternalLink} className="size-3.5 rtl:-scale-x-100" />
          </Link>
        ))}
        {result ? (
          <Ltr>
            <span className="ms-auto text-meta text-fg-muted">{t('ranFor', { ms: result.durationMs })}</span>
          </Ltr>
        ) : null}
      </div>
    </Card>
  );
}

function Panel({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'neutral' | 'success' | 'danger' | 'info';
  children: React.ReactNode;
}) {
  const surface = {
    neutral: 'bg-surface-muted',
    success: 'bg-success-surface',
    danger: 'bg-danger-surface',
    info: 'bg-info-surface',
  }[tone];
  return (
    <div className={cn('rounded-control p-3', surface)}>
      <p className="mb-1 text-meta font-semibold uppercase tracking-wide text-fg-2">{label}</p>
      {children}
    </div>
  );
}
