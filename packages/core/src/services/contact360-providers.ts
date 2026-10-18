// Contact 360 providers (T-117, F2.8): plug conversations / payments / appointments into the customer record.
// Importing this module registers them (side effect); the 360 route imports it so it always runs.
// Each provider runs inside the 360 transaction AFTER the contact itself passed the visibility scope, so it only
// filters by contact id. Payment amounts follow the opportunity-value mask (F1.4).
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { canSeeValue } from '../auth/mask';
import { registerContact360Provider, type RelatedItem } from './crm-contact360';
import { isoReq, rows } from './crm-shared';

type R = Record<string, unknown>;
const at = (d: unknown) => (d ? isoReq(d as Date | string) : null);
const clip = (s: unknown, n = 80) => {
  const v = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return v.length > n ? `${v.slice(0, n)}…` : v;
};

registerContact360Provider('conversations', async (tx: Tx, _actor, contactId) => {
  const convs = await rows<R>(
    tx,
    sql`select id, display_name, external_key, last_message_at, unread_count, opted_out
        from conversations where contact_id = ${contactId}::uuid order by last_message_at desc nulls last limit 5`,
  );
  const out: RelatedItem[] = [];
  for (const c of convs) {
    out.push({
      id: String(c.id),
      label: `WhatsApp ${String(c.external_key)}`,
      status: c.opted_out ? 'opted_out' : Number(c.unread_count) > 0 ? `${c.unread_count} unread` : null,
      at: at(c.last_message_at),
    });
    const msgs = await rows<R>(
      tx,
      sql`select id, direction, kind, body, status, created_at from messages
          where conversation_id = ${String(c.id)}::uuid order by created_at desc limit 8`,
    );
    for (const m of msgs) {
      out.push({
        id: String(m.id),
        label: `${m.direction === 'in' ? '←' : '→'} ${clip(m.body) || String(m.kind)}`,
        status: String(m.status),
        at: at(m.created_at),
      });
    }
  }
  return out;
});

registerContact360Provider('payments', async (tx, actor, contactId) => {
  const showMoney = canSeeValue(actor);
  const prs = await rows<R>(
    tx,
    sql`select id, description, display_text, status, coalesce(paid_at, created_at) as at
        from payment_requests where contact_id = ${contactId}::uuid order by created_at desc limit 20`,
  );
  return prs.map((p) => ({
    id: String(p.id),
    label: [showMoney ? p.display_text : null, p.description].filter(Boolean).join(' · ') || 'Payment',
    status: String(p.status),
    at: at(p.at),
  }));
});

registerContact360Provider('appointments', async (tx, _actor, contactId) => {
  const as = await rows<R>(
    tx,
    sql`select id, title, status, starts_at from appointments
        where contact_id = ${contactId}::uuid order by starts_at desc limit 20`,
  );
  return as.map((a) => ({
    id: String(a.id),
    label: String(a.title),
    status: String(a.status),
    at: at(a.starts_at),
  }));
});
