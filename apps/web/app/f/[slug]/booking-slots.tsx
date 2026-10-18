'use client';
// Instant booking on the public form success page (T-216, I3.8): the assigned owner's free slots
// (free/busy) and one-tap booking. Plain fetch: public, CSRF-exempt endpoints; the signed token is the credential.
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

interface Slot {
  startsAt: string;
  endsAt: string;
}
type State = 'loading' | 'ready' | 'none' | 'expired' | 'booked';

const TZ = 'Asia/Karachi';
const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(iso),
  );
const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(
    new Date(iso),
  );

export function BookingSlots({ slug, token }: { slug: string; token: string }) {
  const t = useTranslations('leads.form.booking');
  const [state, setState] = useState<State>('loading');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busyAt, setBusyAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [when, setWhen] = useState('');

  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`/api/public/forms/${slug}/slots?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) return setState('expired');
        const body = (await res.json()) as { slots?: Slot[] };
        const list = body.slots ?? [];
        setSlots(list);
        setState(list.length ? 'ready' : 'none');
      })
      .catch(() => live && setState('expired'));
    return () => {
      live = false;
    };
  }, [slug, token, reloads]);

  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots) m.set(dayKey(s.startsAt), [...(m.get(dayKey(s.startsAt)) ?? []), s]);
    return [...m.values()];
  }, [slots]);

  async function book(s: Slot) {
    setBusyAt(s.startsAt);
    setMessage(null);
    try {
      const res = await fetch(`/api/public/forms/${slug}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, startsAt: s.startsAt }),
      });
      if (res.ok) {
        setWhen(`${dayLabel(s.startsAt)}, ${timeLabel(s.startsAt)} PKT`);
        setState('booked');
        return;
      }
      const err = (await res.json().catch(() => null)) as {
        error?: { details?: { reason?: string } };
      } | null;
      const reason = err?.error?.details?.reason;
      if (reason === 'already_booked') setMessage(t('alreadyBooked'));
      else if (res.status === 409) {
        setMessage(t('taken'));
        setReloads((n) => n + 1);
      } else if (res.status === 404) setState('expired');
      else setMessage(t('failed'));
    } catch {
      setMessage(t('failed'));
    } finally {
      setBusyAt(null);
    }
  }

  if (state === 'booked')
    return (
      <p role="status" className="mt-4 rounded-card bg-success-surface p-4 text-body text-success">
        {t('confirmed', { when })}
      </p>
    );
  return (
    <section aria-labelledby="book-title" className="mt-6 rounded-card border border-line bg-surface p-4">
      <h2 id="book-title" className="text-panel text-fg">
        {t('title')}
      </h2>
      {state === 'loading' ? <p className="mt-2 text-body text-fg-2">{t('loading')}</p> : null}
      {state === 'none' ? <p className="mt-2 text-body text-fg-2">{t('none')}</p> : null}
      {state === 'expired' ? <p className="mt-2 text-body text-fg-2">{t('expired')}</p> : null}
      {state === 'ready' ? (
        <>
          <p className="mt-1 text-meta text-fg-2">{t('help')}</p>
          {message ? (
            <p role="alert" className="mt-2 text-meta text-danger">
              {message}
            </p>
          ) : null}
          <div className="mt-3 space-y-4">
            {days.map((list) => (
              <div key={list[0]!.startsAt}>
                <h3 className="text-meta font-semibold text-fg">{dayLabel(list[0]!.startsAt)}</h3>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {list.map((s) => (
                    <li key={s.startsAt}>
                      <button
                        type="button"
                        disabled={busyAt !== null}
                        aria-label={`${t('book')}: ${dayLabel(s.startsAt)} ${timeLabel(s.startsAt)}`}
                        onClick={() => void book(s)}
                        className="inline-flex h-11 items-center rounded-control border border-line-strong bg-surface px-3 text-button text-fg hover:bg-surface-muted disabled:opacity-50"
                      >
                        {busyAt === s.startsAt ? t('booking') : timeLabel(s.startsAt)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
