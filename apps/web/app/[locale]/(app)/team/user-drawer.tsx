'use client';
// Edit one member: level + roles (users.manage), per-user overrides (roles.manage), end sessions (Owner),
// deactivate (never a hard delete). Owner-protection is enforced by the API (403); the UI just hides.
import type { UserSummary } from '@relay/contracts/api/users';
import type { PermissionKey } from '@relay/contracts/permissions';
import { PERMISSION_KEYS } from '@relay/contracts/permissions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog, Drawer, DrawerContent, FormField, StatusBadge } from '@/components/relay';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';
import { qk } from '@/lib/query/keys';
import { permI18nKey } from './permission-groups';

type Override = { permission: PermissionKey; effect: 'grant' | 'deny' };

export function UserDrawer(props: {
  user: UserSummary | null;
  onClose: () => void;
  selfId: string;
  isOwner: boolean;
  canManageRoles: boolean;
}) {
  const { user } = props;
  return (
    <Drawer open={!!user} onOpenChange={(o) => !o && props.onClose()}>
      {user ? <Body key={`${user.id}:${user.version}`} {...props} user={user} /> : null}
    </Drawer>
  );
}

function Body({
  user,
  onClose,
  selfId,
  isOwner,
  canManageRoles,
}: {
  user: UserSummary;
  onClose: () => void;
  selfId: string;
  isOwner: boolean;
  canManageRoles: boolean;
}) {
  const t = useTranslations('team');
  const te = useTranslations();
  const qc = useQueryClient();
  const [level, setLevel] = useState<'admin' | 'user'>(user.baseLevel === 'admin' ? 'admin' : 'user');
  const [roleIds, setRoleIds] = useState<string[]>(user.roles.map((r) => r.id));
  const [confirm, setConfirm] = useState<'deactivate' | 'sessions' | null>(null);

  const isOwnerRow = user.baseLevel === 'owner';
  const isSelf = user.id === selfId;
  const locked = isOwnerRow || (!isOwner && isSelf);
  const fail = (err: unknown) => toast.error(localizeError(err, (k, v) => te(k, v)));
  const refresh = () => qc.invalidateQueries({ queryKey: ['team'] });

  const roles = useQuery({ queryKey: qk.team.roles(), queryFn: () => api.users.roles() });

  const save = useMutation({
    mutationFn: () =>
      api.users.update({
        params: { id: user.id },
        body: { version: user.version, baseLevel: level, roleIds },
      }),
    onSuccess: () => {
      toast.success(t('drawer.saved'));
      void refresh();
      onClose();
    },
    onError: fail,
  });
  const deactivate = useMutation({
    mutationFn: () => api.users.deactivate({ params: { id: user.id }, body: { version: user.version } }),
    onSuccess: () => {
      toast.success(t('drawer.deactivated'));
      void refresh();
      onClose();
    },
    onError: fail,
  });
  const endSessions = useMutation({
    mutationFn: () => api.users.endSessions({ params: { id: user.id } }),
    onSuccess: (r) => {
      toast.success(t('drawer.sessionsEnded', { count: r.revoked }));
      setConfirm(null);
    },
    onError: fail,
  });

  const dirty =
    (!isOwnerRow && level !== user.baseLevel) ||
    roleIds.length !== user.roles.length ||
    roleIds.some((id) => !user.roles.some((r) => r.id === id));

  return (
    <DrawerContent title={user.name} description={<span dir="ltr">{user.email}</span>}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={user.isActive ? 'success' : 'disabled'}>
            {user.isActive ? t('members.active') : t('members.deactivated')}
          </StatusBadge>
          {isOwnerRow ? <StatusBadge tone="info">{t('drawer.ownerProtected')}</StatusBadge> : null}
        </div>

        {user.isActive && !locked ? (
          <>
            <FormField label={t('drawer.level')} helper={isOwner ? undefined : t('drawer.levelHelp')}>
              {(p) => (
                <Select value={level} onValueChange={(v) => setLevel(v as 'admin' | 'user')}>
                  <SelectTrigger {...p}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user" disabled={!isOwner && user.baseLevel === 'admin'}>
                      {t('levels.user')}
                    </SelectItem>
                    <SelectItem value="admin" disabled={!isOwner}>
                      {t('levels.admin')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </FormField>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-meta font-medium text-fg">{t('drawer.roles')}</legend>
              {(roles.data?.items ?? []).map((r) => (
                <label key={r.id} className="flex min-h-10 items-center gap-3 text-body">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-strong"
                    checked={roleIds.includes(r.id)}
                    onChange={(e) =>
                      setRoleIds((cur) => (e.target.checked ? [...cur, r.id] : cur.filter((x) => x !== r.id)))
                    }
                  />
                  {r.name}
                </label>
              ))}
              {roles.data && roles.data.items.length === 0 ? (
                <p className="text-meta text-fg-2">{t('drawer.noRoles')}</p>
              ) : null}
            </fieldset>

            <Button
              variant="primary"
              loading={save.isPending}
              disabled={!dirty}
              onClick={() => save.mutate()}
            >
              {t('drawer.save')}
            </Button>
          </>
        ) : null}

        {canManageRoles && user.isActive && !isOwnerRow ? <Overrides userId={user.id} /> : null}

        {user.isActive && (!isOwnerRow || isOwner) ? (
          <section className="flex flex-col gap-3 border-t border-line pt-4">
            <h3 className="text-panel text-fg">{t('drawer.danger')}</h3>
            {isOwner ? (
              <Button variant="secondary" onClick={() => setConfirm('sessions')}>
                {t('drawer.endSessions')}
              </Button>
            ) : null}
            {!isOwnerRow && !isSelf ? (
              <Button variant="destructive" onClick={() => setConfirm('deactivate')}>
                {t('drawer.deactivate')}
              </Button>
            ) : null}
          </section>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm === 'deactivate'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('drawer.deactivateTitle', { name: user.name })}
        description={t('drawer.deactivateBody')}
        confirmLabel={t('drawer.deactivate')}
        destructive
        loading={deactivate.isPending}
        onConfirm={() => deactivate.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'sessions'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('drawer.endSessionsTitle', { name: user.name })}
        description={t('drawer.endSessionsBody')}
        confirmLabel={t('drawer.endSessions')}
        loading={endSessions.isPending}
        onConfirm={() => endSessions.mutate()}
      />
    </DrawerContent>
  );
}

function Overrides({ userId }: { userId: string }) {
  const t = useTranslations('team');
  const ts = useTranslations('settings');
  const te = useTranslations();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.team.overrides(userId),
    queryFn: () => api.users.overrides({ params: { id: userId } }),
  });
  const [draft, setDraft] = useState<Override[] | null>(null);
  const items = draft ?? q.data?.items ?? [];
  const setItems = (f: (cur: Override[]) => Override[]) => setDraft(f(items));
  const [perm, setPerm] = useState<PermissionKey>('crm.export');
  const [effect, setEffect] = useState<'grant' | 'deny'>('grant');

  const save = useMutation({
    mutationFn: () => api.users.setOverrides({ params: { id: userId }, body: { items } }),
    onSuccess: (r) => {
      toast.success(t('drawer.overridesSaved'));
      qc.setQueryData(qk.team.overrides(userId), r);
      setDraft(null);
    },
    onError: (err) => toast.error(localizeError(err, (k, v) => te(k, v))),
  });

  const dirty = JSON.stringify(items) !== JSON.stringify(q.data?.items ?? []);
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="text-panel text-fg">{t('drawer.overrides')}</h3>
      <p className="text-meta text-fg-2">{t('drawer.overridesHelp')}</p>
      <ul className="flex flex-col gap-2">
        {items.map((o) => (
          <li key={o.permission} className="flex items-center justify-between gap-2 text-body">
            <span className="min-w-0 truncate">
              <StatusBadge tone={o.effect === 'grant' ? 'success' : 'danger'}>
                {t(`drawer.${o.effect}`)}
              </StatusBadge>{' '}
              {ts(`permissions.keys.${permI18nKey(o.permission)}`)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setItems((cur) => cur.filter((x) => x.permission !== o.permission))}
            >
              {t('drawer.remove')}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <FormField label={t('drawer.permission')} className="min-w-0 flex-1">
          {(p) => (
            <Select value={perm} onValueChange={(v) => setPerm(v as PermissionKey)}>
              <SelectTrigger {...p}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {ts(`permissions.keys.${permI18nKey(k)}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField label={t('drawer.effect')}>
          {(p) => (
            <Select value={effect} onValueChange={(v) => setEffect(v as 'grant' | 'deny')}>
              <SelectTrigger {...p}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grant">{t('drawer.grant')}</SelectItem>
                <SelectItem value="deny">{t('drawer.deny')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>
        <Button
          variant="secondary"
          onClick={() =>
            setItems((cur) => [...cur.filter((x) => x.permission !== perm), { permission: perm, effect }])
          }
        >
          {t('drawer.add')}
        </Button>
      </div>
      <Button variant="secondary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
        {t('drawer.saveOverrides')}
      </Button>
    </section>
  );
}
