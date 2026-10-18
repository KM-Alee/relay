'use client';
// Integrations page body (I5.1, I5.6, I4.4). Minimal semantic markup + token-agnostic classes until the
// design system (Lane D) lands; no raw colours, logical properties only, all strings from next-intl.
import type { IntegrationCardDto, IntegrationsListResponse } from '@relay/contracts/api/integrations';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { api, localizeError } from '@/lib/api-client';

export function IntegrationsView() {
  const t = useTranslations('integrations');
  const [data, setData] = useState<IntegrationsListResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const [tick, setTick] = useState(0);
  const load = async () => setTick((n) => n + 1);
  useEffect(() => {
    let live = true;
    api.integrations.list().then(
      (d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [tick]);

  if (failed) return <p role="alert">{t('loadFailed')}</p>;
  if (!data) return <p aria-busy="true">{t('loading')}</p>;
  return (
    <div className="space-y-6">
      <p className="opacity-70">{t('subtitle')}</p>
      {data.cards.map((c) => (
        <Card key={c.provider} card={c} slack={data.slack} onChanged={load} />
      ))}
      <p className="text-sm opacity-70">
        {t('lastTick', { when: data.lastTickAt ? data.lastTickAt : t('never') })}
      </p>
    </div>
  );
}

function Card({
  card,
  slack,
  onChanged,
}: {
  card: IntegrationCardDto;
  slack: IntegrationsListResponse['slack'];
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('integrations');
  const fmt = useFormatter();
  const tr = useTranslations();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conn = card.connection;
  const breaker = conn?.health.state ?? 'closed';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const secretsIn: Record<string, string> = {};
    const publicIn: Record<string, string> = {};
    for (const f of card.secretFields) {
      const v = String(form.get(f) ?? '').trim();
      if (v) secretsIn[f] = v;
    }
    for (const f of card.publicFields) {
      const v = String(form.get(f) ?? '').trim();
      if (v) publicIn[f] = v;
    }
    try {
      await api.integrations.connect({
        params: { provider: card.provider },
        body: { secrets: secretsIn, publicConfig: publicIn },
      });
      setEditing(false);
      setError(null);
      await onChanged();
    } catch (err) {
      setError(localizeError(err, tr));
    }
  }

  async function disconnect() {
    try {
      await api.integrations.disconnect({ params: { provider: card.provider } });
      await onChanged();
    } catch (err) {
      setError(localizeError(err, tr));
    }
  }

  async function breakerTo(state: 'open' | 'closed') {
    await api.integrations.forceBreaker({ params: { provider: card.provider }, body: { state } });
    await onChanged();
  }

  return (
    <section aria-labelledby={`int-${card.provider}`} className="rounded-lg border p-4 space-y-3">
      <header className="flex items-center justify-between gap-3">
        <h2 id={`int-${card.provider}`} className="text-lg font-semibold">
          {t(`providers.${card.provider}.name`)}
        </h2>
        <span className="rounded-full border px-3 py-1 text-sm" data-status={card.status}>
          {t(`status.${card.status}`)}
        </span>
      </header>

      <p className="text-sm">
        {t('lastOk', {
          when: conn?.lastOkAt
            ? fmt.dateTime(new Date(conn.lastOkAt), { dateStyle: 'medium', timeStyle: 'short' })
            : t('never'),
        })}
      </p>
      {card.platformDefault && !conn?.secretsHint ? <p className="text-sm">{t('platformDefault')}</p> : null}
      {conn && conn.health.state !== 'closed' ? (
        <p role="status" className="text-sm font-medium">
          {t(`breaker.${breaker}`)}
        </p>
      ) : null}
      {card.provider === 'slack' ? (
        <p className="text-sm">
          {t('slackCoverage', { linked: slack.linkedUsers, total: slack.totalUsers })}
        </p>
      ) : null}
      {card.deadJobs > 0 ? (
        <p role="alert" className="text-sm font-medium">
          {t('deadJobs', { count: card.deadJobs })}
        </p>
      ) : null}

      <p className="text-sm opacity-80">{t(`providers.${card.provider}.limits`)}</p>

      {card.webhookUrls.length ? (
        <div className="text-sm">
          <p className="font-medium">{t('webhookUrls')}</p>
          <ul className="mt-1 space-y-1">
            {card.webhookUrls.map((u) => (
              <li key={u.url}>
                <span className="opacity-70">{t(u.label as 'webhook')}: </span>
                <code dir="ltr" className="break-all">
                  {u.url}
                </code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="text-sm">
        <p className="font-medium">{t('recentErrors')}</p>
        {card.recentErrors.length === 0 ? (
          <p className="opacity-70">{t('noErrors')}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {card.recentErrors.map((e) => (
              <li key={e.id}>
                {fmt.dateTime(new Date(e.createdAt), { dateStyle: 'short', timeStyle: 'short' })}:{' '}
                {t.has(`errorCodes.${e.error ?? ''}`)
                  ? t(`errorCodes.${e.error}` as 'errorCodes.generic')
                  : t('errorCodes.generic')}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? <p role="alert">{error}</p> : null}

      {card.connectable ? (
        editing ? (
          <form onSubmit={submit} className="space-y-2">
            {[...card.publicFields, ...card.secretFields].map((f) => {
              const isSecret = card.secretFields.includes(f);
              return (
                <label key={f} className="block text-sm">
                  <span className="block">{t(`fields.${f}` as 'fields.apiKey')}</span>
                  <input
                    name={f}
                    type={isSecret ? 'password' : 'text'}
                    autoComplete="off"
                    dir="ltr"
                    defaultValue={isSecret ? '' : (conn?.publicConfig[f] ?? '')}
                    className="mt-1 w-full rounded border px-2 py-1"
                  />
                  {isSecret && conn?.secretFieldsSet.includes(f) ? (
                    <span className="text-xs opacity-70">
                      {t('secretHint', { hint: conn.secretsHint ?? '••••' })}
                    </span>
                  ) : null}
                </label>
              );
            })}
            <div className="flex gap-2">
              <button type="submit" className="rounded border px-3 py-1">
                {t('actions.save')}
              </button>
              <button type="button" className="rounded border px-3 py-1" onClick={() => setEditing(false)}>
                {t('actions.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border px-3 py-1" onClick={() => setEditing(true)}>
              {conn?.secretFieldsSet.length ? t('actions.update') : t('actions.connect')}
            </button>
            {conn?.secretFieldsSet.length ? (
              <button type="button" className="rounded border px-3 py-1" onClick={() => void disconnect()}>
                {t('actions.disconnect')}
              </button>
            ) : null}
            {conn ? (
              <button
                type="button"
                className="rounded border px-3 py-1"
                onClick={() => void breakerTo(conn.health.state === 'open' ? 'closed' : 'open')}
              >
                {conn.health.state === 'open' ? t('actions.forceClosed') : t('actions.forceOpen')}
              </button>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}
