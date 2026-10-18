// Instant booking after the public web form (T-216, I3.8). Owner: Lane C.
// After a submit, if the lead is in handler custody and its owner has a connected calendar, the success page
// offers the owner's free slots (free/busy, I3.4); picking one creates the appointment on the owner's real
// calendar (I3.3) and the contact gets the localized WhatsApp confirmation (I3.9).
// No session: access is a short-lived HMAC token minted on submit (workspace, lead, owner, expiry). The page
// never learns who the owner is (03 T1 step 6: same answer whatever the routing outcome).
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PublicFormSubmit } from '@relay/contracts/api/leads';
import { withSystemTx, withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { config } from '../config';
import { BOOKING_TZ, bookingWindow, computeSlots, type Slot } from '../domain/booking-slots';
import { AppError, notFound } from '../errors';
import { log } from '../log';
import * as teamsRepo from '../repos/teams';
import { availability, createAppointment } from './calendar';
import { actorForUser } from './user-actor';

const TOKEN_TTL_MS = 45 * 60_000;

interface TokenData {
  w: string; // workspace
  l: string; // lead
  u: string; // owner user
  e: number; // expiry (ms)
}

const mac = (body: string) =>
  createHmac('sha256', config.core.SESSION_SECRET).update(`booking:${body}`).digest('base64url');

export function signBookingToken(d: TokenData): string {
  const body = Buffer.from(JSON.stringify(d)).toString('base64url');
  return `${body}.${mac(body)}`;
}

export function verifyBookingToken(token: string, now: Date): TokenData | null {
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i);
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(mac(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenData;
    return d.e > now.getTime() && d.w && d.l && d.u ? d : null;
  } catch {
    return null;
  }
}

interface LeadCtx {
  leadId: string;
  ownerId: string;
  contactId: string | null;
  contactName: string;
  contactEmail: string | null;
}

/** Called right after the lead was created for this submit. Returns a token when instant booking is possible. */
export async function offerBooking(
  slug: string,
  body: Pick<PublicFormSubmit, 'phone' | 'email'>,
  now: Date = new Date(),
): Promise<{ bookingAvailable: boolean; bookingToken?: string }> {
  try {
    const found = await withSystemTx((tx) => teamsRepo.lookupWebForm(tx, slug));
    if (!found) return { bookingAvailable: false };
    const lead = await withWorkspaceTx(found.workspaceId, async (tx) => {
      const phone = body.phone?.trim() || null;
      const email = body.email?.trim() || null;
      return (
        await tx.execute<{ id: string; owner_user_id: string; custody: string; status: string }>(
          sql`select id, owner_user_id, custody, status from leads
            where source_kind = 'web_form' and source_id = ${found.formId}
              and ((${phone}::text is not null and contact_phone = ${phone}) or (${email}::text is not null and contact_email = ${email}))
              and created_at > ${new Date(now.getTime() - 2 * 60_000).toISOString()}::timestamptz
            order by created_at desc limit 1`,
        )
      ).rows[0];
    });
    if (!lead || lead.custody !== 'handler' || lead.status !== 'open') return { bookingAvailable: false };
    const actor = await actorForUser(found.workspaceId, lead.owner_user_id);
    if (!actor || !(actor.baseLevel !== 'user' || actor.permissions.has('appointments.manage')))
      return { bookingAvailable: false };
    const { from, to } = bookingWindow(now);
    const av = await availability(actor, lead.owner_user_id, from, to, now);
    if (!av.bookable) return { bookingAvailable: false };
    const slots = computeSlots(
      now,
      av.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
    );
    if (!slots.length) return { bookingAvailable: false };
    return {
      bookingAvailable: true,
      bookingToken: signBookingToken({
        w: found.workspaceId,
        l: lead.id,
        u: lead.owner_user_id,
        e: now.getTime() + TOKEN_TTL_MS,
      }),
    };
  } catch (err) {
    log.warn('instant_booking.offer_failed', { err });
    return { bookingAvailable: false }; // never breaks the form submit
  }
}

async function loadLead(d: TokenData): Promise<LeadCtx> {
  const row = await withWorkspaceTx(
    d.w,
    async (tx) =>
      (
        await tx.execute<{
          id: string;
          owner_user_id: string;
          contact_id: string | null;
          contact_name: string;
          contact_email: string | null;
          status: string;
          custody: string;
        }>(
          sql`select id, owner_user_id, contact_id, contact_name, contact_email, status, custody from leads where id = ${d.l}`,
        )
      ).rows[0],
  );
  // The lead must still be open and with the same owner the token was minted for.
  if (!row || row.status !== 'open' || row.owner_user_id !== d.u) throw notFound();
  return {
    leadId: row.id,
    ownerId: row.owner_user_id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
  };
}

/** GET slots for a token: fresh free/busy each time. */
export async function listSlots(
  token: string,
  now: Date = new Date(),
): Promise<{ timezone: string; slots: Slot[] }> {
  const d = verifyBookingToken(token, now);
  if (!d) throw notFound();
  await loadLead(d);
  const actor = await actorForUser(d.w, d.u);
  if (!actor) throw notFound();
  const { from, to } = bookingWindow(now);
  const av = await availability(actor, d.u, from, to, now);
  if (!av.bookable) return { timezone: BOOKING_TZ, slots: [] };
  return {
    timezone: BOOKING_TZ,
    slots: computeSlots(
      now,
      av.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
    ),
  };
}

/** POST book: re-validates the slot against fresh free/busy, then creates the appointment as the owner. */
export async function bookSlot(
  token: string,
  startsAt: string,
  now: Date = new Date(),
): Promise<{ startsAt: string; endsAt: string; timezone: string }> {
  const d = verifyBookingToken(token, now);
  if (!d) throw notFound();
  const lead = await loadLead(d);
  const { slots } = await listSlots(token, now);
  const slot = slots.find((s) => new Date(s.startsAt).getTime() === new Date(startsAt).getTime());
  if (!slot) throw new AppError('CONFLICT', { details: { reason: 'slot_unavailable' } });
  const actor = await actorForUser(d.w, d.u);
  if (!actor) throw notFound();
  // One booking per submission.
  const existing = await withWorkspaceTx(
    d.w,
    async (tx) =>
      (
        await tx.execute<{ id: string }>(
          sql`select id from appointments where lead_id = ${lead.leadId} and status = 'scheduled' limit 1`,
        )
      ).rows[0],
  );
  if (existing) throw new AppError('CONFLICT', { details: { reason: 'already_booked' } });
  const appt = await createAppointment(
    actor,
    {
      userId: lead.ownerId,
      leadId: lead.leadId,
      ...(lead.contactId ? { contactId: lead.contactId } : {}),
      ...(lead.contactEmail ? { attendeeEmail: lead.contactEmail } : {}),
      title: `Consultation: ${lead.contactName}`.slice(0, 200),
      notes: 'Booked by the customer from the website form.',
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      timezone: BOOKING_TZ,
    },
    now,
  );
  return { startsAt: appt.startsAt, endsAt: appt.endsAt, timezone: appt.timezone };
}
