// Localized WhatsApp booking confirmation (I3.9). Owner: Lane C (T-216).
// Triggered by the outbox job `appointment.confirm` that createAppointment() enqueues in its own
// transaction. Free text (customer's language) inside the 24 h window, the approved Meta template
// `booking_confirmation` outside it (I1.10). System-authored, idempotent per appointment version,
// respects opt-out (I1.9). No provider call here: the message goes through the `whatsapp.send` job.
import { withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import {
  WA_TEMPLATES,
  templateKeyFor,
  templateLocaleOf,
  type TemplateBase,
  type TemplateLocale,
} from '../integrations/meta/templates';
import { enqueueJob } from '../integrations/upstream';
import { log } from '../log';
import { emit } from '../realtime';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

const WINDOW_MS = 24 * 3600_000; // same as messaging.WINDOW_MS (not imported: keeps this module cycle-free)

const render = (body: string, params: string[]) =>
  body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');

/** "Mon, 20 Oct, 3:30 pm GMT+5" in the appointment's time zone and the customer's language. */
export function formatWhen(startsAt: Date, timeZone: string, locale: TemplateLocale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-GB', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }).format(startsAt);
  } catch {
    return startsAt.toISOString();
  }
}

export type SystemSendResult =
  | { sent: true; messageId: string; kind: 'text' | 'template' }
  | { sent: false; reason: 'opted_out' | 'no_phone' | 'not_found' | 'duplicate' };

/**
 * Queue a system message to a contact's WhatsApp thread IN THE CALLER'S TX: free text if the 24 h window is
 * open, otherwise the template `base` (en / ur / ur-Latn). Creates the conversation if needed.
 */
export async function queueSystemMessageInTx(
  tx: Tx,
  workspaceId: string,
  o: {
    contactId: string;
    base: TemplateBase;
    /** Builds the positional params once the customer's name and language are known. */
    params: (c: { name: string; locale: TemplateLocale }) => string[];
    clientKey: string;
  },
  now: Date,
): Promise<SystemSendResult> {
  const c = (
    await tx.execute<Loose>(
      sql`select id, name, phone_e164, language, opted_out from contacts where id = ${o.contactId} and deleted_at is null`,
    )
  ).rows[0];
  if (!c) return { sent: false, reason: 'not_found' };
  if (!c.phone_e164) return { sent: false, reason: 'no_phone' };
  if (c.opted_out) return { sent: false, reason: 'opted_out' };
  const conv = (
    await tx.execute<Loose>(sql`insert into conversations (workspace_id, contact_id, external_key, display_name)
      values (${workspaceId}, ${c.id}, ${c.phone_e164}, ${c.name})
      on conflict (workspace_id, channel, external_key) do update
        set contact_id = coalesce(conversations.contact_id, excluded.contact_id)
      returning id, last_inbound_at, opted_out, language`)
  ).rows[0]!;
  if (conv.opted_out) return { sent: false, reason: 'opted_out' };

  const locale = templateLocaleOf(c.language ?? conv.language);
  const variant = WA_TEMPLATES[o.base][locale];
  const params = o.params({ name: c.name, locale });
  const body = render(variant.body, params);
  const open = !!conv.last_inbound_at && now.getTime() < new Date(conv.last_inbound_at).getTime() + WINDOW_MS;
  const kind = open ? 'text' : 'template';
  const ins = await tx.execute<Loose>(sql`insert into messages
    (workspace_id, conversation_id, direction, author_type, kind, body, template_key, template_name, template_lang,
     template_params, status, status_at, client_key)
    values (${workspaceId}, ${conv.id}, 'out', 'system', ${kind}, ${body},
            ${open ? null : templateKeyFor(o.base, locale)}, ${open ? null : variant.name},
            ${open ? null : variant.lang}, ${open ? null : JSON.stringify(params)}::jsonb,
            'queued', ${now.toISOString()}::timestamptz, ${o.clientKey})
    on conflict (conversation_id, client_key) where client_key is not null do nothing
    returning id`);
  const id = ins.rows[0]?.id as string | undefined;
  if (!id) return { sent: false, reason: 'duplicate' };
  await tx.execute(sql`update conversations set
    last_message_at = greatest(coalesce(last_message_at, ${now.toISOString()}::timestamptz), ${now.toISOString()}::timestamptz),
    last_message_preview = ${body.slice(0, 140)}, version = version + 1 where id = ${conv.id}`);
  await enqueueJob(tx, {
    type: 'whatsapp.send',
    payload: { messageId: id },
    dedupeKey: `wa:send:${id}:0`,
    maxAttempts: 6,
  });
  await emit(tx, { workspaceId, topic: 'messages', ids: [id] });
  await emit(tx, { workspaceId, topic: 'conversations', ids: [conv.id] });
  return { sent: true, messageId: id, kind };
}

/** `appointment.confirm` job body (I3.9). Safe to run twice (client_key = appointment + version). */
export async function sendBookingConfirmation(
  workspaceId: string,
  appointmentId: string,
  now: Date = new Date(),
): Promise<SystemSendResult | { sent: false; reason: 'not_scheduled' }> {
  return withWorkspaceTx(workspaceId, async (tx) => {
    const a = (
      await tx.execute<Loose>(
        sql`select id, contact_id, title, starts_at, timezone, status, version from appointments where id = ${appointmentId}`,
      )
    ).rows[0];
    if (!a || a.status !== 'scheduled') return { sent: false as const, reason: 'not_scheduled' as const };
    if (!a.contact_id) return { sent: false as const, reason: 'not_found' as const };
    const r = await queueSystemMessageInTx(
      tx,
      workspaceId,
      {
        contactId: a.contact_id,
        base: 'booking_confirmation',
        clientKey: `appt:${a.id}:${a.version}`,
        params: ({ name, locale }) => [name, a.title, formatWhen(new Date(a.starts_at), a.timezone, locale)],
      },
      now,
    );
    if (!r.sent) log.info('booking_confirmation.skipped', { appointmentId, reason: r.reason });
    return r;
  });
}
