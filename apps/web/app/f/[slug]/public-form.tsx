'use client';
// Public form body (F3.1). Plain fetch: the endpoint is public + CSRF-exempt (/api/public/*).
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { BookingSlots } from './booking-slots';

type Status = 'idle' | 'sending' | 'done' | 'error' | 'limited' | 'needContact';

export function PublicForm({ slug }: { slug: string }) {
  const t = useTranslations('leads.form');
  const [status, setStatus] = useState<Status>('idle');
  const [bookingToken, setBookingToken] = useState<string | null>(null); // I3.8 instant booking

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    if (!s('phone') && !s('email')) return setStatus('needContact');
    setStatus('sending');
    const body: Record<string, string> = { name: s('name') };
    for (const k of ['phone', 'email', 'message', 'website']) if (s(k)) body[k] = s(k);
    try {
      const res = await fetch(`/api/public/forms/${slug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const out = (await res.json().catch(() => null)) as {
          bookingAvailable?: boolean;
          bookingToken?: string;
        } | null;
        if (out?.bookingAvailable && out.bookingToken) setBookingToken(out.bookingToken);
      }
      setStatus(res.ok ? 'done' : res.status === 429 ? 'limited' : 'error');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'done')
    return (
      <>
        <p role="status" className="rounded-card bg-success-surface p-4 text-body text-success">
          {t('success')}
        </p>
        {bookingToken ? <BookingSlots slug={slug} token={bookingToken} /> : null}
      </>
    );
  const field =
    'mt-1 block w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-body text-fg';
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <label className="block text-meta text-fg-2">
        {t('name')}
        <input name="name" required maxLength={200} autoComplete="name" className={field} />
      </label>
      <label className="block text-meta text-fg-2">
        {t('phone')}
        <input name="phone" type="tel" dir="ltr" autoComplete="tel" className={field} />
      </label>
      <label className="block text-meta text-fg-2">
        {t('email')}
        <input name="email" type="email" dir="ltr" autoComplete="email" className={field} />
      </label>
      <label className="block text-meta text-fg-2">
        {t('message')}
        <textarea name="message" rows={3} maxLength={4000} className={field} />
      </label>
      {/* Honeypot (06 §7): hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute -start-[9999px] size-px overflow-hidden">
        <label>
          {t('honeypot')}
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {status === 'error' || status === 'limited' || status === 'needContact' ? (
        <p role="alert" className="text-meta text-danger">
          {t(status === 'limited' ? 'rateLimited' : status === 'needContact' ? 'needContact' : 'failed')}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="inline-flex h-11 w-full items-center justify-center rounded-control bg-brand-strong px-4 text-button text-on-brand-strong hover:bg-brand-strong-hover disabled:opacity-50"
      >
        {status === 'sending' ? t('sending') : t('submit')}
      </button>
    </form>
  );
}
