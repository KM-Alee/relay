'use client';
// Appointments page body (I3.1-I3.7): Google connection panel, team calendar status, week agenda and the booking
// dialog with a free/busy grid. Plain semantic markup + logical-property classes until Lane D's design system lands.
// Times are stored UTC + IANA zone; this view renders in the viewer's zone (users.timezone) with Intl (I3.5).
import type {
  AppointmentDto,
  AvailabilityResponse,
  CalendarConnectionDto,
} from '@relay/contracts/api/calendar';
import { zonedToUtc } from '@relay/core/domain/calendar';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, localizeError } from '@/lib/api-client';

type Team = Awaited<ReturnType<typeof api.calendar.team>>['members'];
const DAY_MS = 86_400_000;

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

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

  if (failed && !appts) return <p role="alert">{t('loadFailed')}</p>;
  if (!appts || !conn) return <p aria-busy="true">{t('loading')}</p>;

  const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * DAY_MS));
  const byDay = (d: Date) =>
    appts.filter((a) => a.status === 'scheduled' && ymd(new Date(a.startsAt), tz) === ymd(d, tz));

  return (
    <div className="space-y-8">
      {banner ? (
        <p role="status" className="rounded border p-3">
          {t(`connection.banner.${banner}`)}
        </p>
      ) : null}

      <ConnectionPanel conn={conn} onChanged={reload} />

      <section aria-label={t('team.title')}>
        <h2 className="mb-2 font-semibold">{t('team.title')}</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {team.map((m) => (
            <li key={m.userId} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {m.name}
                {m.email ? <span className="ms-2 opacity-70">{m.email}</span> : null}
              </span>
              <span className="opacity-80">
                {m.bookable ? t('team.bookable') : t(`team.reason.${m.reason ?? 'no_calendar_connected'}`)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t('title')}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => setWeek(new Date(week.getTime() - 7 * DAY_MS))}
          >
            {t('week.previous')}
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => setWeek(mondayOf(new Date()))}
          >
            {t('week.today')}
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={() => setWeek(new Date(week.getTime() + 7 * DAY_MS))}
          >
            {t('week.next')}
          </button>
          <button
            type="button"
            className="ms-auto rounded border px-3 py-1"
            onClick={() => setDialog({ open: true, edit: null })}
          >
            {t('book.open')}
          </button>
        </div>
        {appts.filter((a) => a.status === 'scheduled').length === 0 ? (
          <p className="mb-3 opacity-70">{t('empty')}</p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-7">
          {days.map((d) => (
            <div key={d.toISOString()} className="rounded border p-2">
              <div className="mb-2 text-sm font-semibold">
                {fmt.dateTime(d, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })}
              </div>
              <ul className="space-y-2">
                {byDay(d).map((a) => (
                  <li key={a.id} className="rounded border p-2 text-xs">
                    <div className="font-medium">{a.title}</div>
                    <div>
                      {fmt.dateTime(new Date(a.startsAt), {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: tz,
                      })}
                      {' – '}
                      {fmt.dateTime(new Date(a.endsAt), { hour: '2-digit', minute: '2-digit', timeZone: tz })}
                    </div>
                    <div className="opacity-70">{t(`agenda.${a.syncStatus}`)}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {a.htmlLink ? (
                        <a className="underline" href={a.htmlLink} target="_blank" rel="noreferrer">
                          {t('agenda.open')}
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setDialog({ open: true, edit: a })}
                      >
                        {t('agenda.reschedule')}
                      </button>
                      <button
                        type="button"
                        className="underline"
                        onClick={async () => {
                          await api.calendar
                            .cancel({ params: { id: a.id }, body: { version: a.version } })
                            .catch(() => undefined);
                          reload();
                        }}
                      >
                        {t('agenda.cancel')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

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

function ConnectionPanel({ conn, onChanged }: { conn: CalendarConnectionDto; onChanged: () => void }) {
  const t = useTranslations('appointments');
  return (
    <section aria-label={t('connection.title')} className="rounded-lg border p-4">
      <h2 className="mb-1 font-semibold">{t('connection.title')}</h2>
      <p className="text-sm">
        <span data-status={conn.status}>{t(`connection.status.${conn.status}`)}</span>
        {conn.email && conn.status === 'connected' ? (
          <span className="ms-2 opacity-70">{t('connection.as', { email: conn.email })}</span>
        ) : null}
      </p>
      {!conn.available ? <p className="mt-2 text-sm opacity-70">{t('connection.unavailable')}</p> : null}
      <div className="mt-3 flex gap-3">
        {conn.available && conn.status !== 'connected' ? (
          // A top-level navigation: the server stores state + PKCE, then redirects to Google's consent screen.
          <form action="/api/integrations/google/start" method="get">
            <button type="submit" className="rounded border px-3 py-1">
              {conn.status === 'needs_reconnect' ? t('connection.reconnect') : t('connection.connect')}
            </button>
          </form>
        ) : null}
        {conn.status === 'connected' || conn.status === 'needs_reconnect' ? (
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={async () => {
              await api.calendar.disconnect().catch(() => undefined);
              onChanged();
            }}
          >
            {t('connection.disconnect')}
          </button>
        ) : null}
      </div>
    </section>
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
  const ref = useRef<HTMLDialogElement>(null);
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
    ref.current?.showModal();
  }, []);

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
            ...(prefill ? { contactId: prefill.contactId } : {}),
            title,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            timezone: tz,
            override,
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

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="book-title"
      className="w-full max-w-lg rounded-lg border p-4"
    >
      <form onSubmit={submit} className="space-y-3">
        <h2 id="book-title" className="font-semibold">
          {t('book.title')}
        </h2>
        <label className="block text-sm">
          {t('book.employee')}
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={!!edit}
            className="mt-1 w-full rounded border px-2 py-1"
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
        </label>
        <label className="block text-sm">
          {t('book.name')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm">
            {t('book.date')}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            {t('book.time')}
            <input
              type="time"
              step={900}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            {t('book.duration')}
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded border px-2 py-1"
            >
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {t('book.minutes', { n: m })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs opacity-70">{t('book.timezone', { tz })}</p>

        <div>
          <div className="mb-1 text-sm font-medium">{t('book.grid')}</div>
          <div
            role="grid"
            aria-label={t('book.grid')}
            className="grid grid-cols-4 gap-1 text-xs sm:grid-cols-7"
          >
            {cells.map((c) => (
              <button
                key={c.label}
                type="button"
                role="gridcell"
                onClick={() => setTime(c.label)}
                data-busy={c.source ?? 'free'}
                data-selected={c.selected}
                title={
                  c.source === 'google'
                    ? t('book.busyGoogle')
                    : c.source === 'relay'
                      ? t('book.busyRelay')
                      : t('book.free')
                }
                className={`rounded border px-1 py-1 ${c.source ? 'line-through opacity-50' : ''} ${c.selected ? 'font-bold underline' : ''}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {avail?.partial ? <p className="mt-1 text-xs opacity-70">{t('book.partial')}</p> : null}
        </div>

        {conflict ? <p role="alert">{t('book.conflict')}</p> : null}
        {needsOverride ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            {t('book.override')}
          </label>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}

        <div className="flex gap-3">
          <button type="submit" disabled={busy || !userId} className="rounded border px-3 py-1">
            {busy ? t('book.saving') : edit ? t('book.update') : t('book.submit')}
          </button>
          <button type="button" className="rounded border px-3 py-1" onClick={() => ref.current?.close()}>
            {t('book.close')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
