'use client';
// Invites (F1.2): create with level/role, copy the single-use link (shown once), revoke, status.
import type { InviteSummary } from '@relay/contracts/api/team-admin';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Copy, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DataTable, EmptyState, FormField, StatusBadge, type Column } from '@/components/relay';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';
import { useFormat } from '@/lib/format/use-format';
import { qk } from '@/lib/query/keys';

const TONE = { pending: 'info', used: 'success', expired: 'disabled', revoked: 'disabled' } as const;
const NO_ROLE = 'none';

export function InvitesTab() {
  const t = useTranslations('team');
  const te = useTranslations();
  const f = useFormat();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.team.invites(), queryFn: () => api.users.invites() });
  const revoke = useMutation({
    mutationFn: (id: string) => api.users.revokeInvite({ params: { id } }),
    onSuccess: () => {
      toast.success(t('invites.revoked'));
      void qc.invalidateQueries({ queryKey: qk.team.invites() });
    },
    onError: (err) => toast.error(localizeError(err, (k, v) => te(k, v))),
  });

  const columns: Column<InviteSummary>[] = [
    {
      id: 'level',
      header: t('invites.level'),
      mobile: 'title',
      cell: (i) => (
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge tone="neutral" icon={Shield}>
            {t(`levels.${i.baseLevel}`)}
          </StatusBadge>
          {i.roleName ? (
            <StatusBadge tone="neutral" icon={BadgeCheck}>
              {i.roleName}
            </StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('invites.status'),
      cell: (i) => <StatusBadge tone={TONE[i.status]}>{t(`invites.statuses.${i.status}`)}</StatusBadge>,
    },
    { id: 'expires', header: t('invites.expires'), cell: (i) => f.dateTime(i.expiresAt) },
    { id: 'by', header: t('invites.createdBy'), cell: (i) => i.usedByName ?? i.createdByName ?? '' },
    {
      id: 'actions',
      header: <span className="sr-only">{t('members.actions')}</span>,
      align: 'end',
      cell: (i) =>
        i.status === 'pending' ? (
          <Button
            size="sm"
            variant="secondary"
            loading={revoke.isPending}
            onClick={() => revoke.mutate(i.id)}
          >
            {t('invites.revoke')}
          </Button>
        ) : null,
    },
  ];

  return (
    <DataTable
      caption={t('invites.caption')}
      columns={columns}
      rows={q.data?.items ?? []}
      rowKey={(i) => i.id}
      loading={q.isPending}
      empty={<EmptyState title={t('invites.empty')} description={t('invites.emptyBody')} />}
    />
  );
}

export function InviteDialog({
  open,
  onOpenChange,
  isOwner,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  isOwner: boolean;
}) {
  const t = useTranslations('team');
  const te = useTranslations();
  const qc = useQueryClient();
  const [level, setLevel] = useState<'admin' | 'user'>('user');
  const [roleId, setRoleId] = useState(NO_ROLE);
  const [link, setLink] = useState<string | null>(null);
  // Roles are listed for users.manage / roles.manage holders; an inviter without them just sees no role picker.
  const roles = useQuery({
    queryKey: qk.team.roles(),
    queryFn: () => api.users.roles(),
    enabled: open,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () =>
      api.users.createInvite({ body: { baseLevel: level, roleId: roleId === NO_ROLE ? null : roleId } }),
    onSuccess: (r) => {
      setLink(r.link);
      void qc.invalidateQueries({ queryKey: qk.team.invites() });
    },
    onError: (err) => toast.error(localizeError(err, (k, v) => te(k, v))),
  });

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setLink(null);
      setLevel('user');
      setRoleId(NO_ROLE);
    }
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('invites.copied'));
    } catch {
      toast.error(t('invites.copyFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title={t('invites.createTitle')}
        description={link ? t('invites.linkOnce') : t('invites.createBody')}
      >
        {link ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                dir="ltr"
                value={link}
                aria-label={t('invites.link')}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button variant="primary" onClick={copy}>
                <Icon icon={Copy} />
                {t('invites.copy')}
              </Button>
            </div>
            <p className="text-meta text-fg-2">{t('invites.singleUse')}</p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">{t('invites.done')}</Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <FormField label={t('invites.level')}>
              {(p) => (
                <Select value={level} onValueChange={(v) => setLevel(v as 'admin' | 'user')}>
                  <SelectTrigger {...p}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">{t('levels.user')}</SelectItem>
                    {isOwner ? <SelectItem value="admin">{t('levels.admin')}</SelectItem> : null}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            {roles.data && roles.data.items.length > 0 ? (
              <FormField label={t('invites.role')} helper={t('invites.roleHelp')}>
                {(p) => (
                  <Select value={roleId} onValueChange={setRoleId}>
                    <SelectTrigger {...p}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ROLE}>{t('invites.noRole')}</SelectItem>
                      {roles.data.items.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">{te('common.actions.cancel')}</Button>
              </DialogClose>
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                {t('invites.create')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
