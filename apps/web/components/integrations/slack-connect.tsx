'use client';
// "Connect Slack" card for the profile page (I4.3). /me mounts <SlackConnect /> (profile-view.tsx).
import type { SlackLinkCode } from '@relay/contracts/api/integrations';
import { Bell } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { toast } from '@/components/ui/toaster';
import { api, localizeError } from '@/lib/api-client';

export function SlackConnect() {
  const t = useTranslations('integrations.slackLink');
  const tr = useTranslations();
  const fmt = useFormatter();
  const [status, setStatus] = useState<{ linked: boolean; available: boolean } | null>(null);
  const [code, setCode] = useState<SlackLinkCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void api.integrations.slackLinkStatus().then(
      (s) => live && setStatus(s),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [tick]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(localizeError(err, tr as never));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  return (
    <Card aria-labelledby="slack-link">
      <CardHeader
        icon={<Bell />}
        titleId="slack-link"
        title={t('title')}
        description={t('description')}
        actions={
          status.available ? (
            <StatusBadge tone={status.linked ? 'success' : 'neutral'}>
              {status.linked ? t('statusLinked') : t('statusNotLinked')}
            </StatusBadge>
          ) : null
        }
      />
      <div className="mt-4 space-y-3 text-body text-fg-2">
        {!status.available ? (
          <p>{t('unavailable')}</p>
        ) : status.linked ? (
          <>
            <p>{t('linked')}</p>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                run(async () => {
                  await api.integrations.slackLinkDelete();
                  setCode(null);
                  setTick((n) => n + 1);
                })
              }
            >
              {t('unlink')}
            </Button>
          </>
        ) : (
          <>
            <p>{t('notLinked')}</p>
            {code ? (
              <div className="space-y-2">
                <p>{t('codeIntro')}</p>
                <code
                  dir="ltr"
                  className="block rounded-control border border-line bg-surface-muted px-3 py-2 font-mono text-body text-fg"
                >
                  {code.command}
                </code>
                <p className="text-meta text-fg-muted">
                  {t('expires', { when: fmt.dateTime(new Date(code.expiresAt), { timeStyle: 'short' }) })}
                </p>
              </div>
            ) : (
              <Button
                variant="primary"
                loading={busy}
                onClick={() => run(async () => setCode(await api.integrations.slackLinkCreate()))}
              >
                {t('connect')}
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
