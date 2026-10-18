'use client';
// Audit log: filterable table (type / user / date) + "Verify integrity" (F4.2, F4.4). Nothing here mutates.
import type { AuditEventDto, AuditVerifyResponse } from '@relay/contracts/api/audit';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  DataTable,
  Drawer,
  DrawerContent,
  EmptyState,
  FormField,
  Ltr,
  PageHeader,
  StatusBadge,
  type Column,
} from '@/components/relay';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, localizeError } from '@/lib/api-client';
import { useFormat } from '@/lib/format/use-format';
import { qk } from '@/lib/query/keys';

const ALL = 'all';
const TYPES = [
  'user',
  'role',
  'invite',
  'lead',
  'workspace',
  'integration',
  'crm',
  'contact',
  'ai',
  'routing',
  'judge',
] as const;

export function AuditView() {
  const t = useTranslations('team');
  const te = useTranslations();
  const f = useFormat();
  const [type, setType] = useState(ALL);
  const [userId, setUserId] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<AuditEventDto | null>(null);

  const filters = {
    type: type === ALL ? undefined : type,
    userId: userId === ALL ? undefined : userId,
    from: from || undefined,
    to: to || undefined,
  };
  const q = useInfiniteQuery({
    queryKey: qk.audit(filters),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.audit.list({ query: { ...filters, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  // The user filter needs users.manage; without it the filter is simply not offered.
  const users = useQuery({
    queryKey: qk.team.members(),
    queryFn: () => api.users.list({ limit: 100 }),
    retry: false,
  });
  const verify = useMutation({ mutationFn: () => api.audit.verify() });

  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const actorLabel = (e: AuditEventDto) =>
    e.actorType === 'user' ? (e.actorName ?? t('audit.unknownUser')) : t(`audit.actor.${e.actorType}`);
  const actionLabel = (a: string) => {
    const key = `audit.actions.${a.replaceAll('.', '_')}`;
    return t.has(key) ? t(key) : a;
  };

  const columns: Column<AuditEventDto>[] = [
    { id: 'when', header: t('audit.when'), mobile: 'title', cell: (e) => f.dateTime(e.occurredAt) },
    { id: 'actor', header: t('audit.actorCol'), cell: actorLabel },
    {
      id: 'action',
      header: t('audit.action'),
      cell: (e) => (
        <span className="flex flex-col">
          <span>{actionLabel(e.action)}</span>
          <Ltr>
            <code className="text-meta text-fg-muted">{e.action}</code>
          </Ltr>
        </span>
      ),
    },
    {
      id: 'target',
      header: t('audit.target'),
      cell: (e) => (
        <Ltr>
          <span className="text-meta">
            {e.targetType}
            {e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ''}
          </span>
        </Ltr>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        description={t('audit.subtitle')}
        actions={
          <Button variant="secondary" loading={verify.isPending} onClick={() => verify.mutate()}>
            <Icon icon={ShieldCheck} />
            {t('audit.verify')}
          </Button>
        }
      />

      <div aria-live="polite">
        {verify.isError ? (
          <div
            role="alert"
            className="mb-4 rounded-card border border-danger bg-danger-surface p-4 text-danger"
          >
            {localizeError(verify.error, (k, v) => te(k, v))}
          </div>
        ) : verify.data ? (
          <VerifyBanner r={verify.data} />
        ) : null}
      </div>

      <form
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
      >
        <FormField label={t('audit.filterType')}>
          {(p) => (
            <Select value={type} onValueChange={setType}>
              <SelectTrigger {...p}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('audit.allTypes')}</SelectItem>
                {TYPES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {t(`audit.types.${x}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        {users.data ? (
          <FormField label={t('audit.filterUser')}>
            {(p) => (
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger {...p}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('audit.allUsers')}</SelectItem>
                  {users.data.items.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        ) : null}
        <FormField label={t('audit.from')}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('audit.to')}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          )}
        </FormField>
      </form>

      {q.isError ? (
        <EmptyState
          title={t('loadFailed')}
          action={<Button onClick={() => q.refetch()}>{te('common.actions.retry')}</Button>}
        />
      ) : (
        <DataTable
          caption={t('audit.caption')}
          columns={columns}
          rows={rows}
          rowKey={(e) => String(e.id)}
          loading={q.isPending}
          onRowOpen={setOpen}
          empty={<EmptyState title={t('audit.empty')} description={t('audit.emptyBody')} />}
          footer={
            q.hasNextPage ? (
              <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                {t('audit.more')}
              </Button>
            ) : null
          }
        />
      )}

      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open ? (
          <DrawerContent
            title={actionLabel(open.action)}
            description={`${actorLabel(open)} · ${f.dateTime(open.occurredAt)}`}
          >
            <dl className="flex flex-col gap-4 text-body">
              <Detail label={t('audit.seq')} value={String(open.seq)} />
              <Detail
                label={t('audit.target')}
                value={`${open.targetType}${open.targetId ? ` · ${open.targetId}` : ''}`}
              />
              {(['before', 'after', 'meta'] as const).map((k) =>
                open[k] ? (
                  <Detail key={k} label={t(`audit.${k}`)} value={JSON.stringify(open[k], null, 2)} pre />
                ) : null,
              )}
            </dl>
          </DrawerContent>
        ) : null}
      </Drawer>
    </>
  );
}

function Detail({ label, value, pre }: { label: string; value: string; pre?: boolean }) {
  return (
    <div>
      <dt className="text-meta text-fg-muted">{label}</dt>
      <dd className="mt-1">
        {pre ? (
          <pre dir="ltr" className="overflow-x-auto rounded-control bg-surface-muted p-3 text-meta">
            {value}
          </pre>
        ) : (
          <Ltr className="break-all">{value}</Ltr>
        )}
      </dd>
    </div>
  );
}

function VerifyBanner({ r }: { r: AuditVerifyResponse }) {
  const t = useTranslations('team');
  return r.ok ? (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-success bg-success-surface p-4"
    >
      <StatusBadge tone="success" strong>
        {t('audit.verifyOk')}
      </StatusBadge>
      <span className="text-body text-fg">{t('audit.verifyOkBody', { count: r.checked })}</span>
    </div>
  ) : (
    <div
      role="alert"
      className="mb-4 flex flex-col gap-2 rounded-card border border-danger bg-danger-surface p-4"
    >
      <StatusBadge tone="danger" strong>
        {t('audit.verifyBroken')}
      </StatusBadge>
      <p className="text-body text-fg">
        {t('audit.verifyBrokenBody', { seq: r.firstBrokenSeq ?? 0, count: r.checked })}
      </p>
      {r.expectedHash ? (
        <Ltr>
          <code className="break-all text-meta">
            {t('audit.expected')}: {r.expectedHash}
          </code>
        </Ltr>
      ) : null}
      {r.storedHash ? (
        <Ltr>
          <code className="break-all text-meta">
            {t('audit.stored')}: {r.storedHash}
          </code>
        </Ltr>
      ) : null}
    </div>
  );
}
