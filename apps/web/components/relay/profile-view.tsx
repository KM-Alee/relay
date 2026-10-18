'use client';
// /me (screens.md section 8): account, language, theme, availability, active sessions with revoke (F1.8),
// and the Connect Slack card (Lane C, I4.3). Revoke is an optimistic mutation with rollback.
import type { SessionSummary } from '@relay/contracts/api/users';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SlackConnect } from '@/components/integrations/slack-connect';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';
import { useFormat } from '@/lib/format/use-format';
import { qk } from '@/lib/query/keys';
import { useAvailability } from '@/lib/query/use-availability';
import { AvailabilitySwitcher } from './availability-switcher';
import { LocaleSwitcher } from './locale-switcher';
import { Ltr } from './ltr';
import { PageHeader } from './page-header';
import { Avatar } from './owner-chip';
import { SkeletonGroup } from './skeleton-group';
import { StatusBadge } from './status-badge';
import { ThemeSwitcher } from './theme-switcher';

/** "Chrome on Linux": proper nouns only, so nothing to translate. */
function describeAgent(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return browser && os ? `${browser} · ${os}` : (browser ?? os);
}

export function ProfileView() {
  const t = useTranslations('common');
  const te = useTranslations();
  const f = useFormat();
  const qc = useQueryClient();
  const availability = useAvailability();

  const me = useQuery({ queryKey: qk.me(), queryFn: ({ signal }) => api.users.me({ signal }), retry: false });
  const sessions = useQuery({
    queryKey: qk.mySessions(),
    queryFn: ({ signal }) => api.users.mySessions({ signal }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.users.revokeMySession(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.mySessions() });
      const previous = qc.getQueryData<{ items: SessionSummary[] }>(qk.mySessions());
      if (previous) qc.setQueryData(qk.mySessions(), { items: previous.items.filter((s) => s.id !== id) });
      return { previous };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.mySessions(), ctx.previous);
      toast.error(localizeError(err, (k, v) => te(k, v)));
    },
    onSuccess: () => toast.success(t('profile.sessions.revoked')),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.mySessions() }),
  });

  const user = me.data?.user;
  return (
    <>
      <PageHeader title={t('profile.title')} description={t('profile.subtitle')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('profile.account')} />
          <div className="mt-4 flex items-center gap-4">
            {user ? (
              <>
                <Avatar name={user.name} className="size-16 text-panel" />
                <div className="min-w-0">
                  <p className="truncate text-panel text-fg">{user.name}</p>
                  <p className="truncate text-body text-fg-2">
                    <Ltr>{user.email}</Ltr>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-meta text-fg-2">
                    <span>{me.data?.workspace.name}</span>
                    <StatusBadge tone="neutral">
                      {t('profile.role')}: {t(`role.${user.baseLevel}`)}
                    </StatusBadge>
                  </p>
                </div>
              </>
            ) : (
              <SkeletonGroup className="flex items-center gap-4">
                <Skeleton className="size-16 rounded-chip" />
                <Skeleton className="h-10 w-48" />
              </SkeletonGroup>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t('profile.language')} description={t('profile.languageHelp')} />
          <div className="mt-4 flex flex-wrap items-center gap-6">
            <LocaleSwitcher />
            <div className="flex items-center gap-3">
              <span className="text-meta text-fg-2">{t('profile.theme')}</span>
              <ThemeSwitcher />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title={t('availability.label')} description={t('profile.availabilityHelp')} />
          <div className="mt-4">
            <AvailabilitySwitcher
              value={availability.value}
              onChange={availability.setValue}
              disabled={availability.pending}
            />
          </div>
        </Card>

        <SlackConnect />

        <Card className="lg:col-span-2">
          <CardHeader title={t('profile.sessions.title')} description={t('profile.sessions.help')} />
          <div className="mt-4">
            {sessions.isPending ? (
              <SkeletonGroup className="space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </SkeletonGroup>
            ) : sessions.isError ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-body text-danger">
                <span>{t('profile.sessions.loadError')}</span>
                <Button size="sm" variant="secondary" onClick={() => void sessions.refetch()}>
                  {t('actions.retry')}
                </Button>
              </div>
            ) : sessions.data.items.length === 0 ? (
              <p className="text-body text-fg-2">{t('profile.sessions.empty')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {sessions.data.items.map((s) => {
                  const Glyph = /Android|iPhone/.test(s.userAgent ?? '') ? Smartphone : Laptop;
                  const device = describeAgent(s.userAgent) ?? t('profile.sessions.unknownDevice');
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span
                        aria-hidden
                        className="flex size-10 shrink-0 items-center justify-center rounded-control bg-surface-muted text-fg-2"
                      >
                        <Glyph className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-body font-medium text-fg">
                          {device}
                          {s.current ? (
                            <StatusBadge tone="success">{t('profile.sessions.current')}</StatusBadge>
                          ) : null}
                        </p>
                        <p className="text-meta text-fg-2">
                          {s.ip ? <Ltr>{s.ip}</Ltr> : null} {s.ip ? '· ' : ''}
                          {t('profile.sessions.lastSeen', { when: f.dateTime(s.lastSeenAt) })} ·{' '}
                          {t('profile.sessions.started', { when: f.dateTime(s.createdAt) })}
                        </p>
                      </div>
                      {!s.current ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={revoke.isPending && revoke.variables === s.id}
                          aria-label={t('profile.sessions.revokeAria', { when: f.dateTime(s.createdAt) })}
                          onClick={() => revoke.mutate(s.id)}
                        >
                          {t('profile.sessions.revoke')}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
