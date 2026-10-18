'use client';
// Appointments page body (I3.1-I3.7): Google connection panel, team calendar status, week agenda and the booking
// dialog with a free/busy grid. Data logic by Lane C; design by Lane D3 (T-228, screens.md §8 "Appointments").
// Times are stored UTC + IANA zone; this view renders in the viewer's zone (users.timezone) with Intl (I3.5).
import type {
  AppointmentDto,
  AvailabilityResponse,
  CalendarConnectionDto,
} from '@relay/contracts/api/calendar';
import { zonedToUtc } from '@relay/core/domain/calendar';
import {
  CalendarCheck2,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Globe,
  MoreHorizontal,
  RefreshCw,
  RotateCw,
  Unplug,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '@/components/relay/confirm-dialog';
import { FormField } from '@/components/relay/form-field';
import { RelayLottie } from '@/components/relay/lottie';
import { Ltr } from '@/components/relay/ltr';
import { FadeIn, Stagger, StaggerItem } from '@/components/relay/motion/primitives';
import { Avatar } from '@/components/relay/owner-chip';
import { SkeletonGroup } from '@/components/relay/skeleton-group';
import { StatusBadge, type StatusTone } from '@/components/relay/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Input, fieldClass } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, localizeError } from '@/lib/api-client';

type Team = Awaited<ReturnType<typeof api.calendar.team>>['members'];
const DAY_MS = 86_400_000;

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

const SYNC: Record<AppointmentDto['syncStatus'], { tone: StatusTone; icon?: LucideIcon }> = {
  synced: { tone: 'success', icon: CalendarCheck2 },
  pending: { tone: 'info', icon: RefreshCw },
  failed: { tone: 'danger' },
};
const CONN: Record<CalendarConnectionDto['status'], StatusTone> = {
  connected: 'success',
  needs_reconnect: 'warning',
  error: 'danger',
  not_connected: 'neutral',
};
const BANNER: Record<string, StatusTone> = {
  connected: 'success',
  denied: 'warning',
  error: 'danger',
  unavailable: 'neutral',
};

export type BookPrefill = { contactId: string; contactName: string };

export function AppointmentsView({
  banner,
  prefill,
}: {
  banner: string | null;
  prefill?: BookPrefill | null;
}) {
  const t = useTranslations('appointments');
  const fmt = useFormatter();
  const [tz, setTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [conn, setConn] = useState<CalendarConnectionDto | null>(null);
  const [team, setTeam] = useState<Team>([]);
  const [appts, setAppts] = useState<AppointmentDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<{ open: boolean; edit: AppointmentDto | null }>({
    open: !!prefill, // "Book appointment" from a contact page opens the dialog with that contact
    edit: null,
  });
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    api.users.me().then(
      (m) => setTz(m.user.timezone),
      () => undefined,
    );
  }, []);

  useEffect(() => {
    let live = true;
    const from = week.toISOString();
    const to = new Date(week.getTime() + 7 * DAY_MS).toISOString();
    Promise.all([
      api.calendar.connection(),
      api.calendar.team(),
      api.calendar.list({ query: { from, to } }),
    ]).then(
      ([c, tm, list]) => {
        if (!live) return;
        setConn(c);
        setTeam(tm.members);
        setAppts(list.appointments);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [week, tick]);

  const anyPending = appts?.some((a) => a.syncStatus === 'pending' && a.status === 'scheduled') ?? false;
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, [anyPending]);

  if (failed && !appts)
    return (
      <div
        role="alert"
        className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger-surface p-4 text-danger"
      >
        <CircleAlert aria-hidden className="size-5 shrink-0" />
        <span className="text-body">{t('loadFailed')}</span>
        <Button size="sm" variant="secondary" className="ms-auto" onClick={reload}>
          <Icon icon={RotateCw} />
          {t('retry')}
        </Button>
      </div>
    );

  const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * DAY_MS));
  const today = ymd(new Date(), tz);
  const byDay = (d: Date) =>
    (appts ?? [])
      .filter((a) => a.status === 'scheduled' && ymd(new Date(a.startsAt), tz) === ymd(d, tz))
      .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  const scheduled = (appts ?? []).filter((a) => a.status === 'scheduled').length;

  return (
    <div className="space-y-6">
      {banner ? (
        <FadeIn>
          <StatusBadge tone={BANNER[banner] ?? 'neutral'} className="px-4 py-2 text-body">
            <span role="status">{t(`connection.banner.${banner}`)}</span>
          </StatusBadge>
        </FadeIn>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="me-auto min-w-0">
          <p className="text-eyebrow text-fg-muted">{t('week.label')}</p>
          {/* client-only text (browser vs server Intl data can differ in spacing): render once data is in */}
          <h2 className="text-panel text-fg">
            {appts ? (
              fmt.dateTimeRange(days[0]!, days[6]!, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: tz,
              })
            ) : (
              <span aria-hidden className="skeleton inline-block h-5 w-40 rounded-control align-middle" />
            )}
          </h2>
        </div>
        <div className="flex items-center gap-1 rounded-control border border-line bg-surface p-1 shadow-card">
          <Button
            size="icon"
            variant="ghost"
            className="size-9 sm:size-9"
            aria-label={t('week.previous')}
            onClick={() => setWeek(new Date(week.getTime() - 7 * DAY_MS))}
          >
            <Icon icon={ChevronLeft} flipInRtl />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWeek(mondayOf(new Date()))}>
            {t('week.today')}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-9 sm:size-9"
            aria-label={t('week.next')}
            onClick={() => setWeek(new Date(week.getTime() + 7 * DAY_MS))}
          >
            <Icon icon={ChevronRight} flipInRtl />
          </Button>
        </div>
        <Button variant="primary" onClick={() => setDialog({ open: true, edit: null })}>
          <Icon icon={CalendarPlus} />
          {t('book.open')}
        </Button>
      </div>

      <div className="grid items-start gap-(--card-gap) xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section
          aria-label={t('title')}
          className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
        >
          {appts && scheduled === 0 ? (
            <div className="flex items-center gap-4 border-b border-line bg-brand-faint/60 px-5 py-3">
              <RelayLottie name="all-clear" className="size-12" />
              <p className="text-body text-fg-2">{t('empty')}</p>
            </div>
          ) : null}
          {!appts ? (
            <SkeletonGroup className="grid gap-px md:grid-cols-7">
              {days.map((d) => (
                <div key={d.toISOString()} className="space-y-3 p-3">
                  <Skeleton className="h-10 w-12" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ))}
            </SkeletonGroup>
          ) : (
            <Stagger as="ul" className="grid divide-y divide-line md:grid-cols-7 md:divide-x md:divide-y-0">
              {days.map((d) => {
                const isToday = ymd(d, tz) === today;
                const items = byDay(d);
                return (
                  <StaggerItem
                    as="li"
                    key={d.toISOString()}
                    className={cn(
                      'flex min-h-0 gap-3 p-3 md:min-h-[22rem] md:flex-col',
                      isToday && 'bg-brand-faint/50',
                    )}
                  >
                    <div
                      className="flex w-14 shrink-0 flex-col items-center md:w-auto md:flex-row md:items-baseline md:gap-2"
                      aria-current={isToday ? 'date' : undefined}
                    >
                      <span className="text-eyebrow text-fg-muted">
                        {fmt.dateTime(d, { weekday: 'short', timeZone: tz })}
                      </span>
                      <span
                        className={cn(
                          'inline-flex size-9 items-center justify-center rounded-chip text-panel tabular',
                          isToday ? 'bg-brand text-on-brand' : 'text-fg',
                        )}
                      >
                        {fmt.dateTime(d, { day: 'numeric', timeZone: tz })}
                      </span>
                      {isToday ? <span className="sr-only">{t('agenda.today')}</span> : null}
                    </div>
                    <ul className="min-w-0 flex-1 space-y-2">
                      {items.length === 0 ? (
                        <li className="py-2 text-meta text-fg-muted md:py-0">{t('agenda.none')}</li>
                      ) : (
                        items.map((a) => (
                          <AppointmentCard
                            key={a.id}
                            a={a}
                            tz={tz}
                            onReschedule={() => setDialog({ open: true, edit: a })}
                            onChanged={reload}
                          />
                        ))
                      )}
                    </ul>
                  </StaggerItem>
                );
              })}
            </Stagger>
          )}
        </section>

        <aside className="grid items-start gap-(--card-gap) md:grid-cols-2 xl:grid-cols-1">
          {conn ? (
            <ConnectionPanel conn={conn} onChanged={reload} />
          ) : (
            <Skeleton className="h-40 w-full rounded-card" />
          )}
          <Card>
            <CardHeader icon={<Users />} title={t('team.title')} />
            <ul className="mt-4 space-y-3">
              {team.map((m) => (
                <li key={m.userId} className="flex items-center gap-3">
                  <Avatar name={m.name} className="size-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-fg">{m.name}</p>
                    {m.email ? (
                      <p className="truncate text-meta text-fg-muted">
                        <Ltr>{m.email}</Ltr>
                      </p>
                    ) : null}
                  </div>
                  {m.bookable ? (
                    <StatusBadge tone="success" icon={CalendarCheck2}>
                      {t('team.bookable')}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone={m.reason === 'calendar_error' ? 'danger' : 'neutral'} icon={Unplug}>
                      <span className="sr-only">
                        {t(`team.reason.${m.reason ?? 'no_calendar_connected'}`)}
                      </span>
                      <span aria-hidden>{t(`team.short.${m.reason ?? 'no_calendar_connected'}`)}</span>
                    </StatusBadge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>

      {dialog.open ? (
        <BookDialog
          key={dialog.edit?.id ?? 'new'}
          tz={tz}
          team={team}
          edit={dialog.edit}
          prefill={prefill ?? null}
          onClose={() => setDialog({ open: false, edit: null })}
          onSaved={() => {
            setDialog({ open: false, edit: null });
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function AppointmentCard({
  a,
  tz,
  onReschedule,
  onChanged,
}: {
  a: AppointmentDto;
  tz: string;
  onReschedule: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('appointments');
  const fmt = useFormatter();
  const [confirm, setConfirm] = useState(false);
  const sync = SYNC[a.syncStatus];
  const time = (d: string) => fmt.dateTime(new Date(d), { hour: 'numeric', minute: '2-digit', timeZone: tz });
  return (
    <li className="group relative rounded-control border border-line border-s-[3px] border-s-brand bg-surface p-2.5 shadow-card transition-shadow duration-(--dur-fast) hover:shadow-pop">
      <div className="flex items-start gap-1">
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 text-meta tabular">
          <time dateTime={a.startsAt} className="font-semibold text-fg">
            <Ltr>{time(a.startsAt)}</Ltr>
          </time>
          <span className="text-fg-muted">
            {t('book.minutes', { n: Math.round((+new Date(a.endsAt) - +new Date(a.startsAt)) / 60_000) })}
          </span>
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('agenda.actions', { title: a.title })}
            className="-me-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {a.htmlLink ? (
              <DropdownMenuItem asChild>
                <a href={a.htmlLink} target="_blank" rel="noreferrer">
                  <Icon icon={ExternalLink} className="text-fg-2" />
                  {t('agenda.open')}
                </a>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onReschedule}>
              <Icon icon={CalendarDays} className="text-fg-2" />
              {t('agenda.reschedule')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setConfirm(true)} className="text-danger">
              <Icon icon={XCircle} />
              {t('agenda.cancel')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-0.5 line-clamp-3 text-body font-medium leading-snug text-fg">{a.title}</p>
      <StatusBadge tone={sync.tone} icon={sync.icon} className="mt-2 max-w-full rounded-control">
        {t(`agenda.${a.syncStatus}`)}
      </StatusBadge>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('cancelConfirm.title')}
        description={t('cancelConfirm.body', { title: a.title })}
        confirmLabel={t('agenda.cancel')}
        destructive
        onConfirm={async () => {
          await api.calendar
            .cancel({ params: { id: a.id }, body: { version: a.version } })
            .catch(() => undefined);
          setConfirm(false);
          onChanged();
        }}
      />
    </li>
  );
}

function ConnectionPanel({ conn, onChanged }: { conn: CalendarConnectionDto; onChanged: () => void }) {
  const t = useTranslations('appointments');
  const tone = CONN[conn.status];
  return (
    <Card>
      <CardHeader
        icon={<CalendarDays />}
        title={t('connection.title')}
        actions={
          <StatusBadge tone={tone} icon={conn.status === 'connected' ? CalendarCheck2 : undefined}>
            {t(`connection.status.${conn.status}`)}
          </StatusBadge>
        }
      />
      {conn.email && conn.status === 'connected' ? (
        <p className="mt-3 flex items-center gap-2 text-meta text-fg-2">
          <span className="live-dot text-success" data-live="true" aria-hidden />
          <span className="min-w-0 truncate">{t('connection.as', { email: conn.email })}</span>
        </p>
      ) : null}
      {!conn.available ? <p className="mt-3 text-meta text-fg-muted">{t('connection.unavailable')}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {conn.available && conn.status !== 'connected' ? (
          // A top-level navigation: the server stores state + PKCE, then redirects to Google's consent screen.
          <form action="/api/integrations/google/start" method="get">
            <Button type="submit" variant="secondary">
              <Icon icon={Globe} />
              {conn.status === 'needs_reconnect' ? t('connection.reconnect') : t('connection.connect')}
            </Button>
          </form>
        ) : null}
        {conn.status === 'connected' || conn.status === 'needs_reconnect' ? (
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              await api.calendar.disconnect().catch(() => undefined);
              onChanged();
            }}
          >
            <Icon icon={Unplug} />
            {t('connection.disconnect')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

const DURATIONS = [15, 30, 45, 60, 90, 120];
const GRID_START = 7; // 07:00
const GRID_CELLS = 28; // to 21:00, 30-minute cells

function BookDialog({
  tz,
  team,
  edit,
  prefill,
  onClose,
  onSaved,
}: {
  tz: string;
  team: Team;
  edit: AppointmentDto | null;
  prefill: BookPrefill | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('appointments');
  const tr = useTranslations();
  const bookable = team.filter((m) => m.bookable);
  const [userId, setUserId] = useState(edit?.userId ?? bookable[0]?.userId ?? '');
  const [date, setDate] = useState(() =>
    ymd(edit ? new Date(edit.startsAt) : new Date(Date.now() + DAY_MS), tz),
  );
  const [time, setTime] = useState(() =>
    edit
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(edit.startsAt))
      : '10:00',
  );
  const [minutes, setMinutes] = useState(() =>
    edit ? Math.round((+new Date(edit.endsAt) - +new Date(edit.startsAt)) / 60_000) : 30,
  );
  const [title, setTitle] = useState(edit?.title ?? prefill?.contactName ?? '');
  const [avail, setAvail] = useState<AvailabilityResponse | null>(null);
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsOverride, setNeedsOverride] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    const from = zonedToUtc(date, '00:00', tz).toISOString();
    const to = new Date(+zonedToUtc(date, '00:00', tz) + DAY_MS).toISOString();
    api.calendar.availability({ params: { userId }, query: { from, to } }).then(
      (a) => live && setAvail(a),
      () => live && setAvail(null),
    );
    return () => {
      live = false;
    };
  }, [userId, date, tz]);

  const start = zonedToUtc(date, time, tz);
  const end = new Date(start.getTime() + minutes * 60_000);
  const busyBlocks = (avail?.busy ?? []).filter(
    (b) =>
      !(edit && b.source === 'relay' && new Date(b.start).getTime() === new Date(edit.startsAt).getTime()),
  );
  const conflict = busyBlocks.some((b) => new Date(b.start) < end && new Date(b.end) > start);

  const cells = Array.from({ length: GRID_CELLS }, (_, i) => {
    const h = GRID_START + Math.floor(i / 2);
    const label = `${String(h).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
    const cs = zonedToUtc(date, label, tz);
    const ce = new Date(cs.getTime() + 30 * 60_000);
    const hit = busyBlocks.find((b) => new Date(b.start) < ce && new Date(b.end) > cs);
    return { label, source: hit?.source ?? null, selected: cs < end && ce > start };
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (edit) {
        await api.calendar.reschedule({
          params: { id: edit.id },
          body: {
            version: edit.version,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            timezone: tz,
            title,
            override,
          },
        });
      } else {
        await api.calendar.create({
          body: {
            userId,
            title,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            timezone: tz,
            override,
            ...(prefill ? { contactId: prefill.contactId } : {}),
          },
        });
      }
      onSaved();
    } catch (err) {
      const details = (err as { details?: { reason?: string; canOverride?: boolean } }).details;
      if (details?.reason === 'calendar_conflict') setNeedsOverride(!!details.canOverride);
      setError(localizeError(err, tr) || t('book.failed'));
    } finally {
      setBusy(false);
    }
  }

  const stateLabel = (c: (typeof cells)[number]) =>
    c.source === 'google'
      ? t('book.busyGoogle')
      : c.source === 'relay'
        ? t('book.busyRelay')
        : t('book.free');

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent
        title={edit ? t('book.rescheduleTitle') : t('book.title')}
        description={t('book.timezone', { tz })}
        className="max-w-2xl"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('book.employee')}>
              {(p) => (
                <select
                  {...p}
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  disabled={!!edit}
                  className={cn(fieldClass, 'h-11 sm:h-10')}
                >
                  {team.map((m) => (
                    <option key={m.userId} value={m.userId} disabled={!m.bookable}>
                      {m.bookable
                        ? m.name
                        : t('book.notBookable', {
                            name: m.name,
                            reason: t(`team.reason.${m.reason ?? 'no_calendar_connected'}`),
                          })}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label={t('book.name')} required>
              {(p) => (
                <Input
                  {...p}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              )}
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <FormField label={t('book.date')} className="col-span-2 sm:col-span-1">
              {(p) => (
                <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              )}
            </FormField>
            <FormField label={t('book.time')}>
              {(p) => (
                <Input
                  {...p}
                  type="time"
                  step={900}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField label={t('book.duration')}>
              {(p) => (
                <select
                  {...p}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  className={cn(fieldClass, 'h-11 sm:h-10')}
                >
                  {DURATIONS.map((m) => (
                    <option key={m} value={m}>
                      {t('book.minutes', { n: m })}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>

          <fieldset className="rounded-card border border-line bg-surface-muted/60 p-3">
            <legend className="px-1 text-meta font-medium text-fg">{t('book.grid')}</legend>
            <div
              role="group"
              aria-label={t('book.grid')}
              className="grid grid-cols-4 gap-1.5 sm:grid-cols-7"
              dir="ltr"
            >
              {cells.map((c) => {
                const clash = c.selected && c.source;
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => setTime(c.label)}
                    data-busy={c.source ?? 'free'}
                    data-selected={c.selected}
                    aria-pressed={c.selected}
                    aria-label={`${c.label}, ${stateLabel(c)}`}
                    title={stateLabel(c)}
                    className={cn(
                      'h-9 rounded-control border text-meta tabular transition-colors duration-(--dur-fast)',
                      !c.source && !c.selected && 'border-line bg-surface text-fg hover:border-line-strong',
                      c.source === 'google' &&
                        !clash &&
                        'hatch border-line bg-surface-muted text-fg-muted line-through',
                      c.source === 'relay' &&
                        !clash &&
                        'hatch border-info/30 bg-info-surface text-info line-through',
                      c.selected && !c.source && 'border-brand bg-brand-soft font-semibold text-fg',
                      clash && 'hatch border-danger bg-danger-surface font-semibold text-danger line-through',
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-meta text-fg-2" aria-hidden>
              <Legend cls="border-line bg-surface" label={t('book.free')} />
              <Legend cls="border-brand bg-brand-soft" label={t('book.selected')} />
              <Legend cls="hatch border-line bg-surface-muted" label={t('book.busyGoogle')} />
              <Legend cls="hatch border-info/30 bg-info-surface" label={t('book.busyRelay')} />
            </ul>
            {avail?.partial ? <p className="mt-2 text-meta text-warning">{t('book.partial')}</p> : null}
          </fieldset>

          {conflict ? (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-control bg-warning-surface px-3 py-2 text-meta text-warning"
            >
              <CircleAlert aria-hidden className="size-4 shrink-0" />
              {t('book.conflict')}
            </p>
          ) : null}
          {needsOverride ? (
            <label className="flex items-center gap-2 text-body text-fg">
              <input
                type="checkbox"
                className="size-4 accent-(--brand-strong)"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              {t('book.override')}
            </label>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-control bg-danger-surface px-3 py-2 text-meta text-danger"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('book.close')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!userId}>
              {busy ? t('book.saving') : edit ? t('book.update') : t('book.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-3.5 rounded-[4px] border', cls)} />
      {label}
    </li>
  );
}
