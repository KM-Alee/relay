'use client';
// Escalation policy editor (T-124 basic form + T-202 builder): guided RuleSummary ⇄ advanced FlowCanvas,
// TestPanel, versioned Publish (optimistic, rollback on error, audited server-side).
import type { PolicyDto } from '@relay/contracts/api/automations';
import type { TeamDto } from '@relay/contracts/api/teams';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, GitBranch, ListChecks, RotateCcw, Rocket } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { FormField } from '@/components/relay/form-field';
import { api } from '@/lib/api-client';
import { useFormat } from '@/lib/format/use-format';
import { NativeSelect, useDuration } from './parts';
import { chainSeconds, draftOf, isDirty, toInput, validate, type Draft } from './policy-model';
import { RuleSummary } from './rule-summary';
import { TestPanel } from './test-panel';
import {
  aqk,
  patchPolicyCache,
  useErrorToast,
  usePeople,
  usePolicies,
  useTeams,
  type Person,
} from './use-automations';

const FlowCanvas = dynamic(() => import('./flow-canvas').then((m) => m.FlowCanvas), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

export function PolicyEditor() {
  const tc = useTranslations('automations.common');
  const policies = usePolicies();
  const teams = useTeams();
  const people = usePeople(teams.data?.items);
  const [teamId, setTeamId] = useState<string | null>(null);
  const team =
    teams.data?.items.find((x) => x.id === teamId) ??
    teams.data?.items.find((x) => x.isDefault) ??
    teams.data?.items[0];
  const policy = policies.data?.items.find((p) => p.id === team?.escalationPolicyId);

  if (policies.isError || teams.isError) {
    return (
      <Card role="alert" className="border-danger/40 bg-danger-surface">
        <p className="text-body text-fg">{tc('loadFailed')}</p>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => {
            void policies.refetch();
            void teams.refetch();
          }}
        >
          {tc('retry')}
        </Button>
      </Card>
    );
  }
  if (!team || !policy || !teams.data) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]" aria-busy>
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  // Remount (fresh draft) when the published version or the selected team changes.
  return (
    <PolicyEditorBody
      key={`${team.id}:${policy.id}:${policy.version}`}
      team={team}
      allTeams={teams.data.items}
      onPickTeam={setTeamId}
      policy={policy}
      people={people}
    />
  );
}

function PolicyEditorBody({
  team,
  allTeams,
  onPickTeam,
  policy,
  people,
}: {
  team: TeamDto;
  allTeams: TeamDto[];
  onPickTeam: (id: string) => void;
  policy: PolicyDto;
  people: Person[];
}) {
  const t = useTranslations('automations.policy');
  const tc = useTranslations('automations.common');
  const qc = useQueryClient();
  const fmt = useFormat();
  const dur = useDuration();
  const reduce = useReducedMotion();
  const onError = useErrorToast();
  const [view, setView] = useState<'guided' | 'flow'>('guided');
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(policy));

  const base = useMemo(() => draftOf(policy), [policy]);
  const dirty = isDirty(draft, base);
  const invalid = validate(draft).length > 0;
  const names = {
    backup: team.backupUserId ? people.find((p) => p.id === team.backupUserId)?.name : undefined,
    manager: team.managerUserId ? people.find((p) => p.id === team.managerUserId)?.name : undefined,
  };

  const publish = useMutation({
    mutationFn: () =>
      api.automations.publishPolicy(policy.id, {
        repeatCount: draft.repeatCount,
        levels: toInput(draft),
        version: policy.version,
      }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: aqk.policies });
      // Same version on purpose: the editor only remounts when the server confirms a new one.
      const optimistic: PolicyDto = {
        ...policy,
        repeatCount: draft.repeatCount,
        levels: toInput(draft).map((l, i) => ({
          position: i + 1,
          targetType: l.targetType,
          targetUserId: l.targetUserId ?? null,
          timeoutSeconds: l.timeoutSeconds,
        })),
      };
      return { previous: patchPolicyCache(qc, optimistic) };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.policies, ctx.previous);
      onError(err);
      void qc.invalidateQueries({ queryKey: aqk.policies });
    },
    onSuccess: (res) => {
      patchPolicyCache(qc, res);
      void qc.invalidateQueries({ queryKey: aqk.teams });
      toast.success(t('published', { version: res.version }));
    },
  });

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <Card aria-labelledby="policy-title" className="space-y-5">
        <CardHeader
          titleId="policy-title"
          icon={<ListChecks aria-hidden />}
          title={t('title')}
          description={t('description')}
          actions={
            <span className="rounded-chip bg-surface-muted px-2.5 py-0.5 text-meta font-medium text-fg-2">
              {t('version', { version: policy.version })}
            </span>
          }
        />

        <div className="flex flex-wrap items-end justify-between gap-4">
          {allTeams.length > 1 ? (
            <FormField label={t('team')} className="min-w-52">
              {(p) => (
                <NativeSelect {...p} value={team.id} onChange={(e) => onPickTeam(e.target.value)}>
                  {allTeams.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          ) : (
            <p className="text-meta text-fg-2">{t('forTeam', { team: team.name })}</p>
          )}
          <div
            role="tablist"
            aria-label={t('view.label')}
            className="inline-flex rounded-control bg-surface-muted p-1"
          >
            {(['guided', 'flow'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  'inline-flex min-h-10 items-center gap-2 rounded-control px-3 text-button transition-colors',
                  view === v ? 'bg-surface text-fg shadow-card' : 'text-fg-2 hover:text-fg',
                )}
              >
                {v === 'guided' ? (
                  <ListChecks aria-hidden className="size-4" />
                ) : (
                  <GitBranch aria-hidden className="size-4" />
                )}
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        </div>

        {view === 'flow' ? (
          <div className="space-y-2">
            <FlowCanvas
              draft={draft}
              people={people}
              names={names}
              selected={selected}
              onSelect={setSelected}
            />
            <p className="text-meta text-fg-2">{t('flow.hint')}</p>
          </div>
        ) : null}

        <RuleSummary
          draft={draft}
          onChange={setDraft}
          people={people}
          names={names}
          selected={selected}
          onSelect={setSelected}
        />

        <motion.div
          layout={!reduce}
          className="sticky bottom-0 -mx-(--card-pad) -mb-(--card-pad) flex flex-wrap items-center justify-between gap-3 rounded-b-card border-t border-line bg-surface/95 px-(--card-pad) py-3 backdrop-blur"
        >
          <p className="flex items-center gap-2 text-meta text-fg-2" aria-live="polite">
            {dirty ? (
              <>
                <span aria-hidden className="size-2 rounded-chip bg-warning" />
                <span className="font-medium text-fg">{t('unpublished')}</span>
              </>
            ) : (
              <>
                <CheckCircle2 aria-hidden className="size-4 text-success" />
                {t('upToDate', { time: fmt.dateTime(policy.updatedAt) })}
              </>
            )}
            <span className="hidden sm:inline">
              · {t('totalTime', { time: dur(Math.max(1, chainSeconds(draft))) })}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              disabled={!dirty || publish.isPending}
              onClick={() => setDraft(draftOf(policy))}
            >
              <RotateCcw aria-hidden className="size-4" />
              {tc('discard')}
            </Button>
            <Button
              variant="primary"
              loading={publish.isPending}
              disabled={!dirty || invalid}
              onClick={() => publish.mutate()}
            >
              <Rocket aria-hidden className="size-4" />
              {t('publish')}
            </Button>
          </div>
        </motion.div>
        {publish.isError ? (
          <p role="alert" className="text-meta text-danger">
            {tc('publishFailed')}
          </p>
        ) : null}
      </Card>

      <div className="lg:sticky lg:top-4">
        <TestPanel teamId={team.id} draft={draft} />
      </div>
    </div>
  );
}
