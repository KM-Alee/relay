'use client';
// Assignment settings (T-124, F3.3): routing mode, capacity per team, routing retry interval, idle re-trigger.
// P1 behaviours (first-to-claim, idle re-trigger) are only switchable when the workspace flag is on (rule 8).
import type { TeamDto } from '@relay/contracts/api/teams';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hourglass, RotateCcw, Save, Shuffle, Swords } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { FormField } from '@/components/relay/form-field';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query/keys';
import { DurationField, NativeSelect, Switch, useDuration } from './parts';
import { aqk, useErrorToast, useTeams } from './use-automations';

interface Form {
  routingMode: TeamDto['routingMode'];
  defaultCapacity: number;
  routingRetrySeconds: number;
  idleRetriggerEnabled: boolean;
  idleSeconds: number;
}
const formOf = (t: TeamDto): Form => ({
  routingMode: t.routingMode,
  defaultCapacity: t.defaultCapacity,
  routingRetrySeconds: t.routingRetrySeconds,
  idleRetriggerEnabled: t.idleRetriggerEnabled,
  idleSeconds: t.idleSeconds,
});

export function AssignmentSettings() {
  const tc = useTranslations('automations.common');
  const teams = useTeams();
  const me = useQuery({ queryKey: qk.me(), queryFn: ({ signal }) => api.users.me({ signal }) });
  const [teamId, setTeamId] = useState<string | null>(null);
  const team = teams.data?.items.find((x) => x.id === teamId) ?? teams.data?.items[0];
  if (teams.isError)
    return (
      <Card role="alert" className="border-danger/40 bg-danger-surface">
        <p className="text-body text-fg">{tc('loadFailed')}</p>
        <Button className="mt-3" variant="secondary" onClick={() => void teams.refetch()}>
          {tc('retry')}
        </Button>
      </Card>
    );
  if (!team || !teams.data) return <Skeleton className="h-96 w-full" />;
  return (
    <AssignmentForm
      key={`${team.id}:${team.version}`}
      team={team}
      allTeams={teams.data.items}
      onPickTeam={setTeamId}
      flags={me.data?.flags ?? {}}
    />
  );
}

function AssignmentForm({
  team,
  allTeams,
  onPickTeam,
  flags,
}: {
  team: TeamDto;
  allTeams: TeamDto[];
  onPickTeam: (id: string) => void;
  flags: Record<string, boolean>;
}) {
  const t = useTranslations('automations.assignment');
  const tc = useTranslations('automations.common');
  const qc = useQueryClient();
  const dur = useDuration();
  const onError = useErrorToast();
  const [form, setForm] = useState<Form>(() => formOf(team));

  const save = useMutation({
    mutationFn: () => api.automations.updateTeam(team.id, { ...form, version: team.version }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: aqk.teams });
      const previous = qc.getQueryData<{ items: TeamDto[] }>(aqk.teams);
      if (previous)
        qc.setQueryData(aqk.teams, {
          items: previous.items.map((x) => (x.id === team.id ? { ...x, ...form } : x)),
        });
      return { previous };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(aqk.teams, ctx.previous);
      onError(err);
      void qc.invalidateQueries({ queryKey: aqk.teams });
    },
    onSuccess: () => {
      toast.success(t('saved'));
      void qc.invalidateQueries({ queryKey: aqk.teams });
    },
  });

  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(team));
  const firstToClaimOn = flags.ff_first_to_claim === true;
  const idleOn = flags.ff_idle_retrigger === true;
  const modes = [
    { id: 'round_robin' as const, icon: Shuffle, enabled: true },
    { id: 'first_to_claim' as const, icon: Swords, enabled: firstToClaimOn },
  ];

  return (
    <Card aria-labelledby="assign-title" className="space-y-6">
      <CardHeader
        titleId="assign-title"
        icon={<Shuffle aria-hidden />}
        title={t('title')}
        description={t('description')}
      />
      {allTeams.length > 1 ? (
        <FormField label={tc('team')} className="max-w-xs">
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
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-meta font-medium text-fg">{t('mode.label')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {modes.map((m) => {
            const active = form.routingMode === m.id;
            return (
              <label
                key={m.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors',
                  active ? 'border-brand bg-brand-faint ring-1 ring-brand' : 'border-line bg-surface',
                  !m.enabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="routing-mode"
                  className="mt-1 size-4 accent-brand-strong"
                  checked={active}
                  disabled={!m.enabled}
                  onChange={() => setForm({ ...form, routingMode: m.id })}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-body font-medium text-fg">
                    <m.icon aria-hidden className="size-4 text-fg-2" />
                    {t(`mode.${m.id}`)}
                    {m.id === 'first_to_claim' ? (
                      <span className="rounded-chip bg-info-surface px-2 py-0.5 text-meta font-semibold text-info">
                        {t('mode.p1')}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-meta text-fg-2">
                    {t(`mode.${m.id}Hint`)}
                    {!m.enabled ? ` ${t('mode.flagOff')}` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label={t('capacity.label')} helper={t('capacity.helper')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              dir="ltr"
              min={1}
              max={100}
              className="w-28 tabular"
              value={form.defaultCapacity}
              onChange={(e) =>
                setForm({
                  ...form,
                  defaultCapacity: Math.min(100, Math.max(1, Math.round(Number(e.target.value) || 1))),
                })
              }
            />
          )}
        </FormField>
        <div className="flex flex-col gap-1.5">
          <span className="text-meta font-medium text-fg">{t('retry.label')}</span>
          <DurationField
            label={t('retry.label')}
            value={form.routingRetrySeconds}
            onChange={(s) => setForm({ ...form, routingRetrySeconds: Math.max(1, s) })}
          />
          <p className="text-meta text-fg-2">{t('retry.helper')}</p>
        </div>
      </div>

      <div className="space-y-3 rounded-card border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-body font-medium text-fg">
              <Hourglass aria-hidden className="size-4 text-fg-2" />
              {t('idle.label')}
            </p>
            <p className="text-meta text-fg-2">{t('idle.helper')}</p>
          </div>
          <Switch
            checked={form.idleRetriggerEnabled}
            disabled={!idleOn}
            label={t('idle.label')}
            stateLabel={form.idleRetriggerEnabled ? tc('on') : tc('off')}
            onChange={(v) => setForm({ ...form, idleRetriggerEnabled: v })}
          />
        </div>
        {!idleOn ? <p className="text-meta text-fg-2">{t('idle.flagOff')}</p> : null}
        {form.idleRetriggerEnabled ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-fg">{t('idle.after')}</span>
            <DurationField
              label={t('idle.after')}
              value={form.idleSeconds}
              onChange={(s) => setForm({ ...form, idleSeconds: Math.max(1, s) })}
            />
          </div>
        ) : null}
      </div>

      <p className="rounded-control bg-surface-muted p-3 text-meta text-fg-2">
        {t('ackNote', { time: dur(team.ackWindowSeconds) })}
      </p>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setForm(formOf(team))}>
          <RotateCcw aria-hidden className="size-4" />
          {tc('discard')}
        </Button>
        <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
          <Save aria-hidden className="size-4" />
          {tc('save')}
        </Button>
      </div>
    </Card>
  );
}
