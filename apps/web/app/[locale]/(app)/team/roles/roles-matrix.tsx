'use client';
// Matrix: permissions (rows) x [Owner (fixed), Admin level, User level, each custom role] (columns).
// Each toggle saves immediately with the column's `version` (409 STALE_VERSION -> refetch).
// The change applies on the affected users' next request and is audited (server).
import { PERMISSION_KEYS, type PermissionKey } from '@relay/contracts/permissions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';
import { ConfirmDialog, EmptyState, FormField, PageHeader } from '@/components/relay';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';
import { Link } from '@/lib/i18n/navigation';
import { qk } from '@/lib/query/keys';
import { PERMISSION_GROUPS, permI18nKey } from '../permission-groups';

interface Col {
  id: string;
  kind: 'owner' | 'level' | 'role';
  label: string;
  permissions: readonly PermissionKey[];
  version: number;
  seeded?: boolean;
}

export function RolesMatrix({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('settings');
  const tt = useTranslations('team');
  const te = useTranslations();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<Col | null>(null);

  const roles = useQuery({ queryKey: qk.team.roles(), queryFn: () => api.users.roles() });
  const levels = useQuery({ queryKey: qk.team.levels(), queryFn: () => api.users.levelPermissions() });
  const fail = (err: unknown) => {
    toast.error(localizeError(err, (k, v) => te(k, v)));
    void qc.invalidateQueries({ queryKey: ['team'] });
  };
  const done = () => qc.invalidateQueries({ queryKey: ['team'] });

  const toggle = useMutation({
    mutationFn: async (a: { col: Col; key: PermissionKey; on: boolean }) => {
      const next = a.on
        ? [...new Set([...a.col.permissions, a.key])]
        : a.col.permissions.filter((p) => p !== a.key);
      if (a.col.kind === 'role')
        await api.users.updateRole({
          params: { id: a.col.id },
          body: { version: a.col.version, permissions: next },
        });
      else
        await api.users.updateLevelPermissions({
          params: { level: a.col.id as 'admin' | 'user' },
          body: { version: a.col.version, permissions: next },
        });
    },
    onSuccess: () => {
      toast.success(t('roles.saved'));
      void done();
    },
    onError: fail,
  });
  const create = useMutation({
    mutationFn: () => api.users.createRole({ body: { name: name.trim(), permissions: [] } }),
    onSuccess: () => {
      toast.success(t('roles.created'));
      setCreating(false);
      setName('');
      void done();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.users.deleteRole({ params: { id } }),
    onSuccess: () => {
      toast.success(t('roles.deleted'));
      setDeleting(null);
      void done();
    },
    onError: fail,
  });

  const cols: Col[] = [
    { id: 'owner', kind: 'owner', label: tt('levels.owner'), permissions: PERMISSION_KEYS, version: 0 },
    ...(levels.data?.items ?? []).map<Col>((l) => ({
      id: l.baseLevel,
      kind: 'level',
      label: tt(`levels.${l.baseLevel}`),
      permissions: l.permissions,
      version: l.version,
    })),
    ...(roles.data?.items ?? []).map<Col>((r) => ({
      id: r.id,
      kind: 'role',
      label: r.name,
      permissions: r.permissions,
      version: r.version,
      seeded: !!r.key,
    })),
  ];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/team" className="inline-flex items-center gap-1 text-brand-text hover:underline">
            <Icon icon={ArrowLeft} flipInRtl />
            {tt('title')}
          </Link>
        }
        title={t('roles.title')}
        description={canEdit ? t('roles.subtitle') : t('roles.readOnly')}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon icon={Plus} />
              {t('roles.new')}
            </Button>
          ) : null
        }
      />
      {roles.isError || levels.isError ? (
        <EmptyState title={t('roles.loadFailed')} />
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-start text-body">
            <caption className="sr-only">{t('roles.caption')}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky start-0 z-10 border-b border-line bg-surface-muted px-4 py-3 text-start text-meta font-semibold text-fg-2"
                >
                  {t('roles.permission')}
                </th>
                {cols.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    className="border-b border-line bg-surface-muted px-3 py-3 text-center text-meta font-semibold text-fg"
                  >
                    <div className="flex items-center justify-center gap-1">
                      {c.label}
                      {canEdit && c.kind === 'role' && !c.seeded ? (
                        <button
                          type="button"
                          aria-label={t('roles.delete', { name: c.label })}
                          onClick={() => setDeleting(c)}
                          className="inline-flex size-8 items-center justify-center rounded-control text-fg-2 hover:bg-surface hover:text-danger"
                        >
                          <Icon icon={Trash2} className="size-4" />
                        </button>
                      ) : null}
                    </div>
                    <div className="text-meta font-normal text-fg-muted">{t(`roles.kinds.${c.kind}`)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((g) => (
                <Fragment key={g.id}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={cols.length + 1}
                      className="bg-surface-muted/60 px-4 py-2 text-start text-eyebrow text-fg-muted"
                    >
                      {t(`permissions.groups.${g.id}`)}
                    </th>
                  </tr>
                  {g.keys.map((k) => (
                    <tr key={k} className="border-b border-line last:border-b-0">
                      <th
                        scope="row"
                        className="sticky start-0 bg-surface px-4 py-2 text-start font-normal text-fg"
                      >
                        {t(`permissions.keys.${permI18nKey(k)}`)}
                      </th>
                      {cols.map((c) => {
                        const on = c.permissions.includes(k);
                        return (
                          <td key={c.id} className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              className="size-4 accent-brand-strong"
                              checked={on}
                              disabled={!canEdit || c.kind === 'owner' || toggle.isPending}
                              aria-label={`${t(`permissions.keys.${permI18nKey(k)}`)} · ${c.label}`}
                              onChange={(e) => toggle.mutate({ col: c, key: k, on: e.target.checked })}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={t('roles.newTitle')} description={t('roles.newBody')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <FormField label={t('roles.name')} required>
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              )}
            </FormField>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  {te('common.actions.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" variant="primary" loading={create.isPending} disabled={!name.trim()}>
                {t('roles.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('roles.deleteTitle', { name: deleting?.label ?? '' })}
        description={t('roles.deleteBody')}
        confirmLabel={t('roles.deleteConfirm')}
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
