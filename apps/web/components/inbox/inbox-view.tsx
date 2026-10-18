'use client';
/* eslint-disable @next/next/no-img-element -- authed media proxy URLs cannot go through the image optimizer */
// Conversations inbox + thread (T-146; I1.3-I1.11). Plain semantic markup until Lane D's components land:
// no raw colours, logical properties only (ms-/me-/ps-/pe-/start-/end-), every string from next-intl (`inbox`).
// Data refreshes by polling while visible (4 s) and immediately after local actions.
import type { ConversationDto, MessageDto, TemplateDto } from '@relay/contracts/api/messaging';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, localizeError } from '@/lib/api-client';

type Thread = { conversation: ConversationDto; messages: MessageDto[] };
type Filter = 'all' | 'unread' | 'failed';

const POLL_MS = 4000;

function usePoll(fn: () => Promise<void>, deps: unknown[]) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    let live = true;
    const run = () => {
      if (live && !document.hidden) void ref.current();
    };
    run();
    const id = setInterval(run, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function InboxView() {
  const t = useTranslations('inbox');
  const [filter, setFilter] = useState<Filter>('all');
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const r = await api.messaging.list({ query: { filter } });
      setConversations(r.conversations);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [filter]);
  usePoll(loadList, [filter]);

  if (failed && !conversations) return <p role="alert">{t('loadFailed')}</p>;
  return (
    <div className="grid min-h-[70vh] gap-4 md:grid-cols-[20rem_1fr]">
      <section aria-label={t('list.label')} className={selected ? 'hidden md:block' : ''}>
        <div role="tablist" className="mb-3 flex gap-2">
          {(['all', 'unread', 'failed'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className="rounded-full border px-3 py-1 text-sm aria-selected:font-semibold aria-selected:underline"
              onClick={() => setFilter(f)}
            >
              {t(`filter.${f}`)}
            </button>
          ))}
        </div>
        {!conversations ? (
          <p aria-busy="true">{t('loading')}</p>
        ) : conversations.length === 0 ? (
          <p className="opacity-70">{t('empty')}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {conversations.map((c) => (
              <li key={c.id}>
                <ConversationRow c={c} active={c.id === selected} onOpen={() => setSelected(c.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t('thread.label')} className={selected ? '' : 'hidden md:block'}>
        {selected ? (
          <ThreadView id={selected} onBack={() => setSelected(null)} onChanged={loadList} />
        ) : (
          <p className="opacity-70">{t('thread.pick')}</p>
        )}
      </section>
    </div>
  );
}

function ConversationRow({ c, active, onOpen }: { c: ConversationDto; active: boolean; onOpen: () => void }) {
  const t = useTranslations('inbox');
  const fmt = useFormatter();
  return (
    <button
      onClick={onOpen}
      aria-current={active}
      className="flex w-full flex-col gap-1 px-3 py-2 text-start aria-[current=true]:font-semibold"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate">{c.name ?? c.phone}</span>
        <span className="flex items-center gap-2 text-xs opacity-70">
          {c.hasFailed ? <span>{t('row.failed')}</span> : null}
          {c.unreadCount > 0 ? (
            <span className="rounded-full border px-2" aria-label={t('row.unread', { count: c.unreadCount })}>
              {c.unreadCount}
            </span>
          ) : null}
          {c.lastMessageAt ? (
            <time dateTime={c.lastMessageAt}>
              {fmt.dateTime(new Date(c.lastMessageAt), { dateStyle: 'short', timeStyle: 'short' })}
            </time>
          ) : null}
        </span>
      </span>
      <span className="truncate text-sm opacity-70">{c.preview ?? t('row.noMessages')}</span>
      <span className="text-xs opacity-70">{c.windowOpen ? t('window.open') : t('window.closed')}</span>
    </button>
  );
}

function Ticks({ m }: { m: MessageDto }) {
  const t = useTranslations('inbox');
  return (
    <span className="text-xs opacity-70" data-status={m.status}>
      {t(`status.${m.status}`)}
    </span>
  );
}

function Bubble({ m, onRetry }: { m: MessageDto; onRetry: (id: string) => void }) {
  const t = useTranslations('inbox');
  const fmt = useFormatter();
  const out = m.direction === 'out';
  const reason = m.statusReason && m.status === 'failed' ? m.statusReason : null;
  return (
    <li className={`flex flex-col gap-1 ${out ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[85%] rounded-lg border px-3 py-2 ${out ? 'ms-auto' : 'me-auto'}`}>
        {m.media ? <MediaView m={m} /> : null}
        {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
        {!m.body && !m.media ? <p className="opacity-70">{t('thread.unsupported')}</p> : null}
        {m.kind === 'template' ? (
          <p className="text-xs opacity-70">{t('thread.template', { name: m.templateName ?? '' })}</p>
        ) : null}
        <p className="mt-1 flex items-center gap-2 text-xs opacity-70">
          <time dateTime={m.createdAt}>{fmt.dateTime(new Date(m.createdAt), { timeStyle: 'short' })}</time>
          {out ? <Ticks m={m} /> : null}
        </p>
      </div>
      {out && m.status === 'failed' ? (
        <p role="alert" className="flex items-center gap-2 text-sm">
          <span>{t(`failure.${reason ?? 'unknown'}`)}</span>
          {reason !== 'opted_out' ? (
            <button className="rounded border px-2 py-0.5" onClick={() => onRetry(m.id)}>
              {t('thread.retry')}
            </button>
          ) : null}
        </p>
      ) : null}
      {out && m.status === 'queued' && m.statusReason ? (
        <p className="text-xs opacity-70">{t('thread.retrying')}</p>
      ) : null}
    </li>
  );
}

function MediaView({ m }: { m: MessageDto }) {
  const t = useTranslations('inbox');
  if (!m.media) return null;
  const { mime, url, filename } = m.media;
  if (mime.startsWith('image/')) {
    return (
      <img src={url} alt={m.body ?? t('thread.image')} className="mb-2 max-h-72 rounded" loading="lazy" />
    );
  }
  if (mime.startsWith('audio/')) {
    return <audio controls src={url} className="mb-2 max-w-full" aria-label={t('thread.audio')} />;
  }
  return (
    <a href={url} download className="mb-2 block underline">
      {filename ?? t('thread.document')}
    </a>
  );
}

function WindowBanner({ c }: { c: ConversationDto }) {
  const t = useTranslations('inbox');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!c.windowOpen || !c.windowClosesAt) return <p className="text-sm">{t('window.closedHelp')}</p>;
  const mins = Math.max(0, Math.floor((new Date(c.windowClosesAt).getTime() - now) / 60_000));
  return (
    <p className="text-sm">{t('window.openHelp', { hours: Math.floor(mins / 60), minutes: mins % 60 })}</p>
  );
}

function ThreadView({
  id,
  onBack,
  onChanged,
}: {
  id: string;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('inbox');
  const tr = useTranslations();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLLIElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.messaging.messages({ params: { id }, query: {} });
      setThread({ conversation: r.conversation, messages: r.messages });
      if (r.conversation.unreadCount > 0) {
        await api.messaging.markRead({ params: { id } });
        void onChanged();
      }
    } catch (err) {
      setError(localizeError(err, tr));
    }
  }, [id, onChanged, tr]);
  usePoll(load, [id]);

  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [count]);

  async function retry(messageId: string) {
    try {
      await api.messaging.retry({ params: { id, messageId } });
      await load();
    } catch (err) {
      setError(localizeError(err, tr));
    }
  }

  async function toggleOptOut(optedOut: boolean) {
    try {
      await api.messaging.optOut({ params: { id }, body: { optedOut } });
      await load();
      void onChanged();
    } catch (err) {
      setError(localizeError(err, tr));
    }
  }

  if (!thread) return error ? <p role="alert">{error}</p> : <p aria-busy="true">{t('loading')}</p>;
  const c = thread.conversation;
  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <button className="me-3 underline md:hidden" onClick={onBack}>
            {t('thread.back')}
          </button>
          <h2 className="inline text-lg font-semibold">{c.name ?? c.phone}</h2>
          <p className="text-sm opacity-70" dir="ltr">
            {c.phone}
          </p>
        </div>
        <button className="rounded border px-3 py-1 text-sm" onClick={() => toggleOptOut(!c.optedOut)}>
          {c.optedOut ? t('optOut.clear') : t('optOut.apply')}
        </button>
      </header>
      <WindowBanner c={c} />
      {c.optOutSuggested ? (
        <p role="status" className="rounded border p-2 text-sm">
          {t('optOut.suggested')}{' '}
          <button className="underline" onClick={() => toggleOptOut(true)}>
            {t('optOut.apply')}
          </button>
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul className="flex flex-1 flex-col gap-3 overflow-y-auto" aria-live="polite">
        {thread.messages.map((m) => (
          <Bubble key={m.id} m={m} onRetry={retry} />
        ))}
        <li ref={bottom} aria-hidden="true" />
      </ul>
      <Composer
        c={c}
        onSent={async () => {
          setError(null);
          await load();
          void onChanged();
        }}
        onError={(e) => setError(e)}
      />
    </div>
  );
}

function Composer({
  c,
  onSent,
  onError,
}: {
  c: ConversationDto;
  onSent: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const t = useTranslations('inbox');
  const tr = useTranslations();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [tplKey, setTplKey] = useState('');
  const [vals, setVals] = useState<Record<string, string[]>>({});
  const useTemplate = !c.windowOpen;

  useEffect(() => {
    if (!useTemplate) return;
    api.messaging.templates().then(
      (r) => {
        setTemplates(r.templates);
        setTplKey((k) => k || r.templates[0]?.key || '');
      },
      () => undefined,
    );
  }, [useTemplate]);

  const tpl = templates.find((x) => x.key === tplKey);
  const params = Array.from({ length: tpl?.paramCount ?? 0 }, (_, i) => vals[tplKey]?.[i] ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.messaging.send({
        params: { id: c.id },
        body: useTemplate
          ? { kind: 'template', templateKey: tplKey, params }
          : { kind: 'text', text, clientKey: crypto.randomUUID() },
      });
      setText('');
      await onSent();
    } catch (err) {
      const reason = err instanceof ApiError ? (err.details?.reason as string | undefined) : undefined;
      onError(
        reason && ['window_closed', 'opted_out'].includes(reason)
          ? t(`failure.${reason}`)
          : localizeError(err, tr),
      );
    } finally {
      setBusy(false);
    }
  }

  if (c.optedOut) return <p className="rounded border p-2 text-sm">{t('optOut.blocked')}</p>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {useTemplate ? (
        <>
          <label className="text-sm" htmlFor="tpl">
            {t('composer.template')}
          </label>
          <select
            id="tpl"
            className="rounded border px-2 py-1"
            value={tplKey}
            onChange={(e) => setTplKey(e.target.value)}
          >
            {templates.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
          </select>
          {tpl ? <p className="text-sm opacity-70">{tpl.body}</p> : null}
          {params.map((p, i) => (
            <input
              key={i}
              required
              aria-label={t('composer.param', { n: i + 1 })}
              className="rounded border px-2 py-1"
              value={p}
              onChange={(e) =>
                setVals((v) => ({ ...v, [tplKey]: params.map((x, j) => (j === i ? e.target.value : x)) }))
              }
            />
          ))}
        </>
      ) : (
        <textarea
          aria-label={t('composer.message')}
          className="min-h-20 rounded border px-2 py-1"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(e);
          }}
        />
      )}
      <button
        type="submit"
        disabled={busy || (useTemplate ? !tplKey : !text.trim())}
        className="self-end rounded border px-4 py-1 font-semibold disabled:opacity-50"
      >
        {t('composer.send')}
      </button>
    </form>
  );
}
