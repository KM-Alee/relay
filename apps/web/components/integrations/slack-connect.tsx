'use client';
// "Connect Slack" block for the profile page (I4.3). Lane B mounts <SlackConnect /> on /me.
import type { SlackLinkCode } from '@relay/contracts/api/integrations';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

export function SlackConnect() {
  const t = useTranslations('integrations.slackLink');
  const fmt = useFormatter();
  const [status, setStatus] = useState<{ linked: boolean; available: boolean } | null>(null);
  const [code, setCode] = useState<SlackLinkCode | null>(null);

  const [tick, setTick] = useState(0);
  const load = async () => setTick((n) => n + 1);
  useEffect(() => {
    let live = true;
    void api.integrations.slackLinkStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [tick]);

  if (!status) return null;
  return (
    <section aria-labelledby="slack-link" className="space-y-2 rounded-lg border p-4">
      <h2 id="slack-link" className="font-semibold">
        {t('title')}
      </h2>
      {!status.available ? (
        <p className="text-sm">{t('unavailable')}</p>
      ) : status.linked ? (
        <>
          <p className="text-sm">{t('linked')}</p>
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={async () => {
              await api.integrations.slackLinkDelete();
              setCode(null);
              await load();
            }}
          >
            {t('unlink')}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm">{t('notLinked')}</p>
          {code ? (
            <div className="text-sm">
              <p>{t('codeIntro')}</p>
              <code dir="ltr" className="block font-mono text-base">
                {code.command}
              </code>
              <p className="opacity-70">
                {t('expires', { when: fmt.dateTime(new Date(code.expiresAt), { timeStyle: 'short' }) })}
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={async () => setCode(await api.integrations.slackLinkCreate())}
            >
              {t('connect')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
