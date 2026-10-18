'use client';
import type { UserSummary } from '@relay/contracts/api/users';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Avatar, DataTable, EmptyState, StatusBadge, type Column } from '@/components/relay';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query/keys';
import { UserDrawer } from './user-drawer';

const AVAIL_KEY = {
  available: 'available',
  busy: 'busy',
  on_leave: 'onLeave',
  offline: 'offline',
} as const;
const AVAIL_DOT = {
  available: 'bg-success',
  busy: 'bg-warning',
  on_leave: 'bg-info',
  offline: 'bg-neutral',
} as const;

export function MembersTab(props: { selfId: string; isOwner: boolean; canManageRoles: boolean }) {
  const t = useTranslations('team');
  const tc = useTranslations('common');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: qk.team.members(), queryFn: () => api.users.list({ limit: 100 }) });
  const rows = q.data?.items ?? [];
  const selected = rows.find((r) => r.id === openId) ?? null;

  const columns: Column<UserSummary>[] = [
    {
      id: 'name',
      header: t('members.name'),
      mobile: 'title',
      cell: (u) => (
        <span className="flex items-center gap-3">
          <Avatar name={u.name} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{u.name}</span>
            <span dir="ltr" className="block truncate text-meta text-fg-2">
              {u.email}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: 'level',
      header: t('members.level'),
      cell: (u) => (
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge tone={u.baseLevel === 'owner' ? 'info' : 'neutral'} icon={Shield}>
            {t(`levels.${u.baseLevel}`)}
          </StatusBadge>
          {u.roles.map((r) => (
            <StatusBadge key={r.id} tone="neutral" icon={BadgeCheck}>
              {r.name}
            </StatusBadge>
          ))}
        </span>
      ),
    },
    {
      id: 'availability',
      header: t('members.availability'),
      cell: (u) => (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className={`size-2 rounded-full ${AVAIL_DOT[u.availability]}`} />
          {tc(`availability.${AVAIL_KEY[u.availability]}`)}
        </span>
      ),
    },
    {
      id: 'load',
      header: t('members.load'),
      align: 'end',
      cell: (u) => <span className="tabular-nums">{u.openLoad ?? 0}</span>,
    },
    {
      id: 'status',
      header: t('members.status'),
      cell: (u) =>
        u.isActive ? (
          <StatusBadge tone="success">{t('members.active')}</StatusBadge>
        ) : (
          <StatusBadge tone="disabled">{t('members.deactivated')}</StatusBadge>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('members.actions')}</span>,
      align: 'end',
      mobile: 'hide',
      cell: (u) => (
        <Button size="sm" variant="secondary" onClick={() => setOpenId(u.id)}>
          {t('members.manage')}
        </Button>
      ),
    },
  ];

  if (q.isError)
    return (
      <EmptyState
        title={t('loadFailed')}
        action={<Button onClick={() => q.refetch()}>{tc('actions.retry')}</Button>}
      />
    );

  return (
    <>
      <DataTable
        caption={t('members.caption')}
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        loading={q.isPending}
        onRowOpen={(u) => setOpenId(u.id)}
        empty={<EmptyState title={t('members.empty')} />}
      />
      <UserDrawer
        user={selected}
        onClose={() => setOpenId(null)}
        selfId={props.selfId}
        isOwner={props.isOwner}
        canManageRoles={props.canManageRoles}
      />
    </>
  );
}
