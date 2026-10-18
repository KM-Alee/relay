'use client';
// Active sessions (F1.8): see where you are signed in, end any other session.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { EmptyState, Ltr, StatusBadge } from '@/components/relay';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';
import { useFormat } from '@/lib/format/use-format';
import { qk } from '@/lib/query/keys';

export function SessionsCard() {
  const t = useTranslations('team');
  const te = useTranslations();
  const f = useFormat();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.team.sessions(), queryFn: () => api.users.mySessions() });
  const revoke = useMutation({
    mutationFn: (id: string) => api.users.revokeMySession(id),
    onSuccess: () => {
      toast.success(t('me.sessionEnded'));
      void qc.invalidateQueries({ queryKey: qk.team.sessions() });
    },
    onError: (err) => toast.error(localizeError(err, (k, v) => te(k, v))),
  });

  return (
    <Card className="p-5">
      <h2 className="text-panel text-fg">{t('me.sessions')}</h2>
      <p className="mt-1 text-body text-fg-2">{t('me.sessionsBody')}</p>
      {q.isError ? (
        <EmptyState title={t('loadFailed')} />
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {(q.data?.items ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-fg">
                  {s.userAgent ?? t('me.unknownDevice')}
                </p>
                <p className="text-meta text-fg-2">
                  {s.ip ? <Ltr>{s.ip}</Ltr> : null}
                  {s.ip ? ' · ' : ''}
                  {t('me.lastSeen', { when: f.dateTime(s.lastSeenAt) })}
                </p>
              </div>
              {s.current ? (
                <StatusBadge tone="info">{t('me.thisDevice')}</StatusBadge>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={revoke.isPending}
                  onClick={() => revoke.mutate(s.id)}
                >
                  {t('me.endSession')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
