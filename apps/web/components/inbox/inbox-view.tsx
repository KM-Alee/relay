'use client';
/* eslint-disable @next/next/no-img-element -- authed media proxy URLs cannot go through the image optimizer */
// Conversations inbox + thread (T-146; I1.3-I1.11). Data logic by Lane C; premium split view by Lane D3 (T-228)
// per design/screens.md §3 and components.md §4 (ConversationList, MessageBubble, Composer, WindowIndicator).
// Tokens only, logical properties only, every string from next-intl (`inbox`). Polls every 4 s while visible
// and immediately after local actions. A sent text shows at once as "Sending…" and is replaced by the server row.
import { Transcript } from './transcript';
import type { ConversationDto, MessageDto, TemplateDto } from '@relay/contracts/api/messaging';
import {
  ArrowLeft,
  BellOff,
  BellRing,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  FileText,
  Keyboard,
  LayoutTemplate,
  MessagesSquare,
  RotateCw,
  SendHorizontal,
  ShieldBan,
  TriangleAlert,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AIBadge } from '@/components/relay/ai-badge';
import { EmptyState } from '@/components/relay/empty-state';
import { Ltr } from '@/components/relay/ltr';
import { Highlight } from '@/components/relay/motion/highlight';
import { LayoutGroup, PopIn, Presence } from '@/components/relay/motion/presence';
import { FadeIn, useMotionOff } from '@/components/relay/motion/primitives';
import { Avatar } from '@/components/relay/owner-chip';
import { SkeletonGroup } from '@/components/relay/skeleton-group';
import { StatusBadge } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { fieldClass } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError, localizeError } from '@/lib/api-client';

type Thread = { conversation: ConversationDto; messages: MessageDto[] };
type Filter = 'all' | 'unread' | 'failed';

const POLL_MS = 4000;
const DAY_MS = 86_400_000;

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

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

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

  if (failed && !conversations)
    return (
      <div
        role="alert"
        className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger-surface p-4 text-danger"
      >
        <CircleAlert aria-hidden className="size-5 shrink-0" />
        <span className="text-body">{t('loadFailed')}</span>
        <Button size="sm" variant="secondary" className="ms-auto" onClick={() => void loadList()}>
          <Icon icon={RotateCw} />
          {t('thread.retry')}
        </Button>
      </div>
    );

  return (
    <div
      className={cn(
        'grid grid-cols-1 overflow-hidden rounded-card border border-line bg-surface shadow-card md:h-[calc(100dvh-15rem)] md:min-h-[540px] md:grid-cols-[minmax(18rem,22rem)_1fr]',
      )}
    >
      <section
        aria-label={t('list.label')}
        className={cn(
          'flex min-h-0 min-w-0 flex-col border-line md:border-e',
          selected ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <h2 className="text-panel text-fg">{t('list.label')}</h2>
          {conversations ? (
            <span className="text-meta text-fg-muted">
              {t('list.count', { count: conversations.length })}
            </span>
          ) : null}
        </div>
        <LayoutGroup id="inbox-filter">
          <div
            role="tablist"
            aria-label={t('list.label')}
            className="mx-4 mt-3 flex gap-1 rounded-control bg-surface-muted p-1"
          >
            {(['all', 'unread', 'failed'] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'relative isolate flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-control px-2 text-button transition-colors duration-(--dur-fast)',
                  filter === f ? 'text-fg' : 'text-fg-2 hover:text-fg',
                )}
              >
                {filter === f ? (
                  <Highlight
                    layoutId="inbox-filter-pill"
                    className="rounded-control bg-surface shadow-card"
                  />
                ) : null}
                {f === 'failed' ? <Icon icon={TriangleAlert} className="size-3.5" /> : null}
                {t(`filter.${f}`)}
              </button>
            ))}
          </div>
        </LayoutGroup>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {!conversations ? (
            <SkeletonGroup className="space-y-1 px-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="size-10 rounded-chip" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
            </SkeletonGroup>
          ) : conversations.length === 0 ? (
            <EmptyState
              animation="all-clear"
              headingLevel={3}
              title={t('emptyTitle')}
              description={t('empty')}
              className="py-10"
            />
          ) : (
            <LayoutGroup id="inbox-rows">
              <ul className="space-y-0.5">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <ConversationRow c={c} active={c.id === selected} onOpen={() => setSelected(c.id)} />
                  </li>
                ))}
              </ul>
            </LayoutGroup>
          )}
        </div>
      </section>

      <section
        aria-label={t('thread.label')}
        className={cn(
          'min-h-0 min-w-0 flex-col',
          // phones: the open thread is a full-screen sheet (header → messages → composer), WhatsApp-style
          selected ? 'flex max-md:fixed max-md:inset-0 max-md:z-drawer max-md:bg-surface' : 'hidden md:flex',
        )}
      >
        {selected ? (
          <ThreadView key={selected} id={selected} onBack={() => setSelected(null)} onChanged={loadList} />
        ) : (
          <div className="thread-canvas flex flex-1 items-center justify-center">
            <EmptyState
              icon={MessagesSquare}
              headingLevel={3}
              title={t('thread.pickTitle')}
              description={t('thread.pick')}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function ConversationRow({ c, active, onOpen }: { c: ConversationDto; active: boolean; onOpen: () => void }) {
  const t = useTranslations('inbox');
  const fmt = useFormatter();
  const name = c.name ?? c.phone;
  const when = c.lastMessageAt ? new Date(c.lastMessageAt) : null;
  const unread = c.unreadCount > 0;
  return (
    <button
      data-conv-row
      onClick={onOpen}
      aria-current={active}
      className={cn(
        'relative isolate flex w-full items-start gap-3 rounded-control px-3 py-3 text-start transition-colors duration-(--dur-fast)',
        !active && 'hover:bg-surface-muted',
      )}
    >
      {active ? <Highlight layoutId="inbox-row" className="rounded-control bg-brand-soft" /> : null}
      <span className="relative">
        <Avatar name={name} className={cn('size-10', active && 'bg-surface')} />
        {c.optedOut ? (
          <span className="absolute -bottom-0.5 -end-0.5 flex size-4 items-center justify-center rounded-chip border-2 border-surface bg-danger text-on-danger">
            <ShieldBan aria-hidden className="size-2.5" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-body text-fg', unread ? 'font-semibold' : 'font-medium')}>
            {c.name ?? <Ltr>{c.phone}</Ltr>}
          </span>
          {when ? (
            <time
              dateTime={c.lastMessageAt!}
              className={cn('shrink-0 text-meta tabular', unread ? 'font-semibold text-fg' : 'text-fg-muted')}
            >
              {sameDay(when, new Date())
                ? fmt.dateTime(when, { timeStyle: 'short' })
                : fmt.dateTime(when, { day: 'numeric', month: 'short' })}
            </time>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span
            dir="auto"
            className={cn('min-w-0 flex-1 truncate text-meta', unread ? 'text-fg' : 'text-fg-2')}
          >
            {c.preview ?? t('row.noMessages')}
          </span>
          {c.hasFailed ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-meta font-medium text-danger">
              <TriangleAlert aria-hidden className="size-3.5" />
              <span className="sr-only">{t('row.failed')}</span>
            </span>
          ) : null}
          {unread ? (
            <span
              aria-label={t('row.unread', { count: c.unreadCount })}
              className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-chip bg-fg px-1.5 text-[11px] font-semibold leading-none text-surface tabular"
            >
              {c.unreadCount}
            </span>
          ) : null}
        </span>
        {!c.windowOpen ? (
          <span className="mt-1 inline-flex items-center gap-1 text-meta text-fg-muted">
            <Clock3 aria-hidden className="size-3" />
            {t('window.closed')}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Ticks({ m }: { m: MessageDto }) {
  const t = useTranslations('inbox');
  const label = t(`status.${m.status}`);
  const glyph =
    m.status === 'failed'
      ? { icon: CircleAlert, cls: 'text-danger' }
      : m.status === 'read'
        ? { icon: CheckCheck, cls: 'text-info' }
        : m.status === 'delivered'
          ? { icon: CheckCheck, cls: 'text-fg-muted' }
          : m.status === 'sent'
            ? { icon: Check, cls: 'text-fg-muted' }
            : { icon: Clock3, cls: 'text-fg-muted' };
  return (
    <span className="inline-flex items-center" data-status={m.status} title={label}>
      <glyph.icon aria-hidden className={cn('size-3.5', glyph.cls)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Bubble({ m, onRetry }: { m: MessageDto; onRetry: (id: string) => void }) {
  const t = useTranslations('inbox');
  const fmt = useFormatter();
  const out = m.direction === 'out';
  const reason = m.statusReason && m.status === 'failed' ? m.statusReason : null;

  if (m.kind === 'event' || m.authorType === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-chip border border-line bg-surface px-3 py-1 text-meta text-fg-2 shadow-card">
          {m.body ?? t('thread.unsupported')}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1.5', out ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'relative max-w-[min(85%,34rem)] rounded-2xl px-3.5 py-2 shadow-card',
          out
            ? 'rounded-se-md border border-brand-soft bg-brand-faint text-fg'
            : 'rounded-ss-md border border-line bg-surface text-fg',
          out && m.status === 'failed' && 'border-danger/50',
        )}
      >
        {m.authorType === 'ai' ? <AIBadge className="mb-1.5" /> : null}
        {m.media ? <MediaView m={m} /> : null}
        <Transcript m={m} />
        {m.body ? (
          <p dir="auto" className="whitespace-pre-wrap break-words text-body">
            {m.body}
          </p>
        ) : null}
        {!m.body && !m.media ? <p className="text-body text-fg-muted">{t('thread.unsupported')}</p> : null}
        {m.kind === 'template' ? (
          <p className="mt-1 inline-flex items-center gap-1 text-meta text-fg-muted">
            <LayoutTemplate aria-hidden className="size-3.5" />
            {t('thread.template', { name: m.templateName ?? '' })}
          </p>
        ) : null}
        <p className="mt-1 flex items-center justify-end gap-1.5 text-[11px] leading-none text-fg-muted">
          <time dateTime={m.createdAt} className="tabular">
            {fmt.dateTime(new Date(m.createdAt), { timeStyle: 'short' })}
          </time>
          {out ? <Ticks m={m} /> : null}
        </p>
      </div>
      {out && m.status === 'failed' ? (
        <div
          role="alert"
          className="flex max-w-[min(85%,34rem)] flex-wrap items-center gap-2 rounded-control border border-danger/30 bg-danger-surface px-3 py-2 text-meta text-danger"
        >
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t(`failure.${reason ?? 'unknown'}`)}</span>
          {reason !== 'opted_out' ? (
            <Button size="sm" variant="secondary" className="h-8" onClick={() => onRetry(m.id)}>
              <Icon icon={RotateCw} className="size-3.5" />
              {t('thread.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {out && m.status === 'queued' && m.statusReason ? (
        <p className="inline-flex items-center gap-1 text-meta text-fg-muted">
          <RotateCw aria-hidden className="size-3 animate-spin" />
          {t('thread.retrying')}
        </p>
      ) : null}
    </div>
  );
}

function MediaView({ m }: { m: MessageDto }) {
  const t = useTranslations('inbox');
  if (!m.media) return null;
  const { mime, url, filename } = m.media;
  if (mime.startsWith('image/')) {
    return (
      <img
        src={url}
        alt={m.body ?? t('thread.image')}
        className="mb-2 max-h-72 rounded-control border border-line"
        loading="lazy"
      />
    );
  }
  if (mime.startsWith('audio/')) {
    return <audio controls src={url} className="mb-2 max-w-full" aria-label={t('thread.audio')} />;
  }
  return (
    <a
      href={url}
      download
      className="mb-2 flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-body text-brand-text hover:bg-surface-muted"
    >
      <FileText aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{filename ?? t('thread.document')}</span>
    </a>
  );
}

/** WindowIndicator (components.md §4): info while the 24 h window is open, warning once it closed. */
function WindowChip({ c }: { c: ConversationDto }) {
  const t = useTranslations('inbox');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!c.windowOpen || !c.windowClosesAt)
    return (
      <StatusBadge tone="warning" icon={Clock3}>
        {t('window.chipClosed')}
      </StatusBadge>
    );
  const mins = Math.max(0, Math.floor((new Date(c.windowClosesAt).getTime() - now) / 60_000));
  return (
    <StatusBadge tone="info" icon={Clock3}>
      {t('window.chipOpen', { hours: Math.floor(mins / 60), minutes: mins % 60 })}
    </StatusBadge>
  );
}

function DaySeparator({ date }: { date: Date }) {
  const t = useTranslations('inbox');
  const fmt = useFormatter();
  const now = new Date();
  const label = sameDay(date, now)
    ? t('thread.today')
    : sameDay(date, new Date(now.getTime() - DAY_MS))
      ? t('thread.yesterday')
      : fmt.dateTime(date, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div role="separator" aria-label={label} className="sticky top-2 z-10 flex justify-center py-2">
      <span className="rounded-chip border border-line bg-surface/90 px-3 py-0.5 text-meta font-medium text-fg-2 shadow-card backdrop-blur">
        {label}
      </span>
    </div>
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
  const off = useMotionOff();
  const [thread, setThread] = useState<Thread | null>(null);
  const [pending, setPending] = useState<MessageDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.messaging.messages({ params: { id }, query: {} });
      setThread({ conversation: r.conversation, messages: r.messages });
      setPending([]);
      if (r.conversation.unreadCount > 0) {
        await api.messaging.markRead({ params: { id } });
        void onChanged();
      }
    } catch (err) {
      setError(localizeError(err, tr));
    }
  }, [id, onChanged, tr]);
  usePoll(load, [id]);

  const messages = useMemo(() => [...(thread?.messages ?? []), ...pending], [thread, pending]);
  const count = messages.length;
  const first = useRef(true);
  useEffect(() => {
    if (!count) return;
    // scroll the thread pane itself (never the page) to the newest message
    const el = scroller.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: first.current || off ? 'auto' : 'smooth' });
    first.current = false;
  }, [count, off]);

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

  if (!thread)
    return error ? (
      <p role="alert" className="m-6 flex items-center gap-2 text-body text-danger">
        <CircleAlert aria-hidden className="size-4" />
        {error}
      </p>
    ) : (
      <SkeletonGroup className="thread-canvas flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-12 w-1/2 rounded-2xl" />
        <Skeleton className="ms-auto h-16 w-3/5 rounded-2xl" />
        <Skeleton className="h-10 w-2/5 rounded-2xl" />
      </SkeletonGroup>
    );

  const c = thread.conversation;
  const name = c.name ?? c.phone;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
          aria-label={t('thread.back')}
        >
          <Icon icon={ArrowLeft} flipInRtl className="size-5" />
        </Button>
        <Avatar name={name} className="size-10" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-panel text-fg">{name}</h2>
          <p className="text-meta text-fg-muted">
            <Ltr>{c.phone}</Ltr>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:max-w-[45%]">
          {c.optedOut ? (
            <StatusBadge tone="danger" icon={ShieldBan}>
              {t('optOut.label')}
            </StatusBadge>
          ) : (
            <WindowChip c={c} />
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => toggleOptOut(!c.optedOut)}
            aria-label={c.optedOut ? t('optOut.clear') : t('optOut.apply')}
          >
            <Icon icon={c.optedOut ? BellRing : BellOff} />
            <span className="hidden lg:inline">{c.optedOut ? t('optOut.clear') : t('optOut.apply')}</span>
          </Button>
        </div>
      </header>

      {c.optOutSuggested && !c.optedOut ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b border-line bg-warning-surface px-4 py-2.5 text-body text-warning"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t('optOut.suggested')}</span>
          <Button size="sm" variant="secondary" onClick={() => toggleOptOut(true)}>
            {t('optOut.apply')}
          </Button>
        </div>
      ) : null}

      <div
        ref={scroller}
        className="thread-canvas min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
        aria-live="polite"
      >
        <Presence initial={false}>
          {messages.map((m, i) => {
            const d = new Date(m.createdAt);
            const prev = messages[i - 1];
            const newDay = !prev || !sameDay(new Date(prev.createdAt), d);
            return (
              <PopIn key={m.id} from={m.direction === 'out' ? 'end' : 'start'} className="py-1">
                {newDay ? <DaySeparator date={d} /> : null}
                <Bubble m={m} onRetry={retry} />
              </PopIn>
            );
          })}
        </Presence>
      </div>

      {error ? (
        <FadeIn
          role="alert"
          className="flex items-center gap-2 border-t border-danger/30 bg-danger-surface px-4 py-2 text-meta text-danger"
        >
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {error}
        </FadeIn>
      ) : null}

      <Composer
        c={c}
        onOptimistic={(text) =>
          setPending((p) => [
            ...p,
            {
              id: `tmp-${Date.now()}`,
              conversationId: c.id,
              direction: 'out',
              authorType: 'user',
              authorUserId: null,
              kind: 'text',
              body: text,
              templateName: null,
              status: 'queued',
              statusReason: null,
              statusDetail: null,
              media: null,
              createdAt: new Date().toISOString(),
            },
          ])
        }
        onSent={async () => {
          setError(null);
          await load();
          void onChanged();
        }}
        onError={(e) => {
          setPending([]);
          setError(e);
        }}
      />
    </div>
  );
}

function Composer({
  c,
  onOptimistic,
  onSent,
  onError,
}: {
  c: ConversationDto;
  onOptimistic: (text: string) => void;
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
    const draft = text;
    if (!useTemplate) {
      onOptimistic(draft.trim());
      setText('');
    }
    try {
      await api.messaging.send({
        params: { id: c.id },
        body: useTemplate
          ? { kind: 'template', templateKey: tplKey, params }
          : { kind: 'text', text: draft, clientKey: crypto.randomUUID() },
      });
      await onSent();
    } catch (err) {
      if (!useTemplate) setText(draft);
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

  if (c.optedOut)
    return (
      <div className="flex items-center gap-2 border-t border-line bg-surface-muted px-4 py-4 text-body text-fg-2">
        <ShieldBan aria-hidden className="size-4 shrink-0 text-danger" />
        {t('optOut.blocked')}
      </div>
    );

  return (
    <form onSubmit={submit} className="border-t border-line bg-surface p-3 sm:p-4">
      {useTemplate ? (
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-control bg-warning-surface px-3 py-2 text-meta text-warning">
            <Clock3 aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {t('window.closedHelp')}
          </p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr]">
            <div>
              <label className="mb-1 block text-meta text-fg" htmlFor="tpl">
                {t('composer.template')}
              </label>
              <select
                id="tpl"
                className={cn(fieldClass, 'h-10')}
                value={tplKey}
                onChange={(e) => setTplKey(e.target.value)}
              >
                {templates.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            {tpl ? (
              <p
                dir="auto"
                className="self-end rounded-2xl rounded-se-md border border-brand-soft bg-brand-faint px-3.5 py-2 text-body text-fg"
              >
                {tpl.body}
              </p>
            ) : null}
          </div>
          {params.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {params.map((p, i) => (
                <input
                  key={i}
                  required
                  aria-label={t('composer.param', { n: i + 1 })}
                  placeholder={t('composer.param', { n: i + 1 })}
                  className={cn(fieldClass, 'h-10')}
                  value={p}
                  onChange={(e) =>
                    setVals((v) => ({ ...v, [tplKey]: params.map((x, j) => (j === i ? e.target.value : x)) }))
                  }
                />
              ))}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={busy} disabled={!tplKey}>
              <Icon icon={SendHorizontal} flipInRtl />
              {t('composer.send')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-2 rounded-card border border-line-strong bg-surface p-1.5 ps-3 transition-shadow duration-(--dur-fast) focus-within:border-focus">
          <label htmlFor={`composer-${c.id}`} className="sr-only">
            {t('composer.message')}
          </label>
          <textarea
            id={`composer-${c.id}`}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-body text-fg outline-none [field-sizing:content] placeholder:text-fg-muted focus-visible:shadow-none focus-visible:outline-none"
            placeholder={t('composer.placeholder')}
            value={text}
            rows={1}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(e);
            }}
            aria-describedby={`composer-hint-${c.id}`}
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()} className="h-10">
            <Icon icon={SendHorizontal} flipInRtl />
            <span className="hidden sm:inline">{t('composer.send')}</span>
            <span className="sr-only sm:hidden">{t('composer.send')}</span>
          </Button>
        </div>
      )}
      {!useTemplate ? (
        <p id={`composer-hint-${c.id}`} className="mt-1.5 hidden text-meta text-fg-muted sm:block">
          <Keyboard aria-hidden className="me-1 inline size-3.5 align-[-2px]" />
          {t('composer.shortcut')}
        </p>
      ) : null}
    </form>
  );
}
