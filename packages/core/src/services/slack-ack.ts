// Slack "Acknowledge" button (T-203, I4.5). Owner: Lane C.
// Thin layer over the leads service: builds the Actor for the Slack-linked user and calls
// `leads.acknowledge(..., { via: 'slack' })`, so the transition is the same T2 as in the app (version
// guard, audit, activity, realtime). Kept in its own file so slack.ts <-> leads.ts stay acyclic
// (slack.ts loads this lazily). Provider calls happen only via the outbox (`slack.update`).
import { withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { AppError } from '../errors';
import { enqueueJob } from '../integrations/upstream';
import { acknowledge } from './leads';
import type { InteractionCtx } from './slack';
import { actorForUser } from './user-actor';

/** Acknowledge `leadId` as `userId` (T2, via Slack). Throws AppError on stale/not owner. */
export async function acknowledgeAsUser(workspaceId: string, userId: string, leadId: string) {
  const actor = await actorForUser(workspaceId, userId);
  if (!actor) throw new AppError('NOT_FOUND');
  return acknowledge(actor, leadId, { via: 'slack' });
}

const R = {
  en: {
    stale:
      'This lead is no longer assigned to you, so nothing was changed. Open it in Relay to see its current state.',
    already: 'You have already acknowledged this lead.',
    gone: 'This alert is no longer valid.',
    by: (name: string, hhmm: string, lead: string) => `✅ Acknowledged by ${name} at ${hhmm} (PKT): ${lead}`,
    done: 'Acknowledged.',
  },
  ur: {
    stale:
      'یہ لیڈ اب آپ کو تفویض نہیں ہے، اس لیے کچھ نہیں بدلا۔ موجودہ صورتحال دیکھنے کے لیے Relay میں کھولیں۔',
    already: 'آپ یہ لیڈ پہلے ہی تسلیم کر چکے ہیں۔',
    gone: 'یہ الرٹ اب درست نہیں رہا۔',
    by: (name: string, hhmm: string, lead: string) => `✅ ${name} نے ${hhmm} (PKT) پر تسلیم کی: ${lead}`,
    done: 'تصدیق ہو گئی۔',
  },
} as const;

const pktTime = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);

/**
 * `lead_ack` interaction handler. The caller (processInteraction) already verified the signed button
 * value and that the pressing Slack user is the linked recipient. Returns the ephemeral reply (or
 * null when the alert message itself was updated).
 */
export async function slackLeadAck(c: InteractionCtx, now: Date = new Date()): Promise<string | null> {
  const t = R[c.locale === 'ur' ? 'ur' : 'en'];
  const ctx = await withWorkspaceTx(c.workspaceId, async (tx) => {
    const a = (
      await tx.execute<{ lead_id: string }>(sql`select lead_id from slack_alerts where id = ${c.alertId}`)
    ).rows[0];
    if (!a) return null;
    const l = (
      await tx.execute<{ owner_user_id: string; ack_status: string; status: string; contact_name: string }>(
        sql`select owner_user_id, ack_status, status, contact_name from leads where id = ${a.lead_id}`,
      )
    ).rows[0];
    const u = (await tx.execute<{ name: string }>(sql`select name from users where id = ${c.userId}`))
      .rows[0];
    return l && u ? { leadId: a.lead_id, lead: l, userName: u.name } : null;
  });
  if (!ctx) return t.gone;
  const { leadId, lead, userName } = ctx;
  if (lead.status !== 'open' || lead.owner_user_id !== c.userId) return t.stale; // not owner / closed: no change
  if (lead.ack_status === 'acknowledged') return t.already;

  try {
    await acknowledgeAsUser(c.workspaceId, c.userId, leadId);
  } catch (err) {
    if (err instanceof AppError) return t.stale; // LEAD_STATE_CHANGED etc.: raced with the app / a timer
    throw err;
  }

  // Alert bookkeeping + the chat.update go through the outbox (no Slack call here).
  const text = t.by(userName, pktTime(now), lead.contact_name);
  await withWorkspaceTx(c.workspaceId, async (tx) => {
    await tx.execute(sql`update slack_alerts set status = 'acknowledged' where id = ${c.alertId}`);
    await enqueueJob(tx, {
      type: 'slack.update',
      maxAttempts: 4,
      dedupeKey: `slu:ack:${c.alertId}`,
      payload: { kind: 'alert', alertId: c.alertId, text },
    });
  });
  return null;
}
