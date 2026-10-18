'use client';
// Teams management (T-202, F3.2/F3.5): members (round-robin order), designated backup + manager, capacity.
import type { TeamDto } from '@relay/contracts/api/teams';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, ShieldCheck, UserMinus, UsersRound } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { EmptyState } from '@/components/relay/empty-state';
import { FormField } from '@/components/relay/form-field';
import { Avatar } from '@/components/relay/owner-chip';
import { api } from '@/lib/api-client';
import { NativeSelect } from './parts';
import { aqk, useErrorToast, usePeople, useTeams, type Person } from './use-automations';

interface Form {
  name: string;
  managerUserId: string | null;
  backupUserId: string | null;
  defaultCapacity: number;
  memberIds: string[];
}

function TeamDialog({
  open,
  onOpenChange,
  team,
  people,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  team: TeamDto | null;
  people: Person[];
}) {
  const t = useTranslations('automations.teams');
  const tc = useTranslations('automations.common');
  const qc = useQueryClient();
  const onError = useErrorToast();
  const [form, setForm] = useState<Form>(() =>
    team
      ? {
          name: team.name,
          managerUserId: team.managerUserId,
          backupUserId: team.backupUserId,
          defaultCapacity: team.defaultCapacity,
          memberIds: team.members.map((m) => m.userId),
        }
      : { name: '', managerUserId: null, backupUserId: null, defaultCapacity: 5, memberIds: [] },
  );
  const nameOf = (id: string) =>
    people.find((p) => p.id === id)?.name ?? team?.members.find((m) => m.userId === id)?.name ?? id;
  const save = useMutation({
    mutationFn: () =>
      team
        ? api.automations.updateTeam(team.id, { ...form, version: team.version })
        : api.automations.createTeam(form),
    onError,
    onSuccess: () => {
      toast.success(team ? t('updated') : t('created'));
      void qc.invalidateQueries({ queryKey: aqk.teams });
      onOpenChange(false);
    },
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = [...form.memberIds];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setForm({ ...form, memberIds: ids });
  };
  const addable = people.filter((p) => !form.memberIds.includes(p.id));
  const nameInvalid = form.name.trim().length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={team ? t('editTitle') : t('newTitle')} description={t('dialogHint')}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nameInvalid) save.mutate();
          }}
        >
          <FormField
            label={t('name')}
            required
            error={save.isError && nameInvalid ? t('nameRequired') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                value={form.name}
                maxLength={80}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['managerUserId', 'backupUserId'] as const).map((k) => (
              <FormField key={k} label={t(k === 'managerUserId' ? 'manager' : 'backup')}>
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={form[k] ?? ''}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value || null })}
                  >
                    <option value="">{t('none')}</option>
                    {people.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            ))}
          </div>
          <FormField label={t('capacity')} helper={t('capacityHint')} className="max-w-40">
            {(p) => (
              <Input
                {...p}
                type="number"
                dir="ltr"
                min={1}
                max={100}
                className="tabular"
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

          <fieldset className="space-y-2">
            <legend className="text-meta font-medium text-fg">{t('members')}</legend>
            <p className="text-meta text-fg-2">{t('membersHint')}</p>
            {form.memberIds.length === 0 ? (
              <p className="rounded-control bg-surface-muted p-3 text-meta text-fg-2">{t('noMembers')}</p>
            ) : (
              <ol className="space-y-1.5">
                {form.memberIds.map((id, i) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-control border border-line px-3 py-1.5"
                  >
                    <span className="w-5 text-meta tabular text-fg-muted">{i + 1}</span>
                    <Avatar name={nameOf(id)} className="size-7" />
                    <span className="min-w-0 flex-1 truncate text-body">{nameOf(id)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('moveUp', { name: nameOf(id) })}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp aria-hidden className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('moveDown', { name: nameOf(id) })}
                      disabled={i === form.memberIds.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown aria-hidden className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('removeMember', { name: nameOf(id) })}
                      onClick={() => setForm({ ...form, memberIds: form.memberIds.filter((m) => m !== id) })}
                    >
                      <UserMinus aria-hidden className="size-4" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {addable.length ? (
              <NativeSelect
                aria-label={t('addMember')}
                value=""
                onChange={(e) =>
                  e.target.value && setForm({ ...form, memberIds: [...form.memberIds, e.target.value] })
                }
              >
                <option value="">{t('addMember')}</option>
                {addable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
          </fieldset>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {tc('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={nameInvalid}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TeamsManager() {
  const t = useTranslations('automations.teams');
  const tc = useTranslations('automations.common');
  const reduce = useReducedMotion();
  const teams = useTeams();
  const people = usePeople(teams.data?.items);
  const [editing, setEditing] = useState<TeamDto | 'new' | null>(null);

  if (teams.isError)
    return (
      <Card role="alert" className="border-danger/40 bg-danger-surface">
        <p className="text-body text-fg">{tc('loadFailed')}</p>
        <Button className="mt-3" variant="secondary" onClick={() => void teams.refetch()}>
          {tc('retry')}
        </Button>
      </Card>
    );
  if (!teams.data) return <Skeleton className="h-64 w-full" />;

  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);

  return (
    <section aria-labelledby="teams-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="teams-title" className="text-panel text-fg">
            {t('title')}
          </h2>
          <p className="text-meta text-fg-2">{t('description')}</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus aria-hidden className="size-4" />
          {t('new')}
        </Button>
      </div>
      {teams.data.items.length === 0 ? (
        <EmptyState icon={UsersRound} title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {teams.data.items.map((team, i) => (
            <motion.li
              key={team.id}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { delay: i * 0.05, duration: 0.2 }}
            >
              <Card className="h-full space-y-4">
                <CardHeader
                  icon={<UsersRound aria-hidden />}
                  title={
                    <span className="flex items-center gap-2">
                      {team.name}
                      {team.isDefault ? (
                        <span className="rounded-chip bg-surface-muted px-2 py-0.5 text-meta font-medium text-fg-2">
                          {t('default')}
                        </span>
                      ) : null}
                    </span>
                  }
                  description={t('summary', { members: team.members.length, capacity: team.defaultCapacity })}
                  actions={
                    <Button variant="secondary" size="sm" onClick={() => setEditing(team)}>
                      <Pencil aria-hidden className="size-4" />
                      {tc('edit')}
                    </Button>
                  }
                />
                <dl className="grid grid-cols-2 gap-3 text-meta">
                  {(['manager', 'backup'] as const).map((k) => {
                    const n = nameOf(k === 'manager' ? team.managerUserId : team.backupUserId);
                    return (
                      <div key={k} className="rounded-control bg-surface-muted p-3">
                        <dt className="flex items-center gap-1.5 text-fg-2">
                          <ShieldCheck aria-hidden className="size-3.5" />
                          {t(k)}
                        </dt>
                        <dd className="mt-0.5 truncate text-body font-medium text-fg">{n ?? t('none')}</dd>
                      </div>
                    );
                  })}
                </dl>
                <ul className="flex flex-wrap gap-2" aria-label={t('members')}>
                  {team.members.map((m) => (
                    <li
                      key={m.userId}
                      className="inline-flex items-center gap-2 rounded-chip border border-line py-1 ps-1 pe-3 text-meta"
                    >
                      <Avatar name={m.name} className="size-6 text-[10px]" />
                      {m.name}
                    </li>
                  ))}
                </ul>
              </Card>
            </motion.li>
          ))}
        </ul>
      )}
      {editing ? (
        <TeamDialog
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          team={editing === 'new' ? null : editing}
          people={people}
        />
      ) : null}
    </section>
  );
}
