// Slack service (T-145; I4.1-I4.4, F3.9). Owner: Lane C.
//  - linking: /me "Connect Slack" one-time codes + `/relay link <code>` redemption
//  - alerts: enqueueSlackAlert() (Lane A's hook) -> outbox slack.send -> Block Kit DM
//  - inbound processing: slash commands + interaction dispatch by action_id
// Provider calls NEVER happen inside a DB transaction: read -> (tx closed) -> call -> short write tx.
import { randomBytes } from 'node:crypto';
import { withSystemTx, withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../auth/actor';
import { config } from '../config';
import { log } from '../log';
import { breakerAllows } from '../integrations/breaker';
import { redactText, sha256Hex } from '../integrations/redact';
import { getNotifier } from '../integrations/registry';
import {
  buildAlert,
  buildResolved,
  maskValue,
  verifyAlertValue,
  type AlertPurpose,
  type SlackLocale,
} from '../integrations/slack/blocks';
import { DeferJobError } from '../jobs/policy';
import { ProviderError } from '../integrations/types';
import { appendAudit, enqueueJob } from '../integrations/upstream';
import {
  ensurePlatformConnection,
  getWorkspaceConnection,
  recordOutcome,
  slackCredsFromRow,
} from './integrations';
import { normalizeCode } from './integrations-ingest';

// Loosely-typed JSON rows from raw SQL / provider payloads (validated at the edges).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

// ── linking (I4.3) ──────────────────────────────────────────────────────
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const LINK_CODE_TTL_MS = 10 * 60_000;

function newCode(): string {
  const raw = Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

const slackAvailable = (): boolean =>
  !!(config.notifications.SLACK_BOT_TOKEN && config.notifications.SLACK_SIGNING_SECRET);

async function linkStatus(actor: Actor): Promise<{ linked: boolean; available: boolean }> {
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const r = await tx.execute<{ slack_user_id: string | null }>(
      sql`select slack_user_id from users where id = ${actor.userId}`,
    );
    const conn = await getWorkspaceConnection(tx, 'slack');
    return { linked: !!r.rows[0]?.slack_user_id, available: slackAvailable() || !!conn?.secrets_enc };
  });
}

async function createLinkCode(actor: Actor, now: Date = new Date()) {
  const code = newCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await withWorkspaceTx(actor.workspaceId, async (tx) => {
    // One live code per user: mint invalidates older unused ones.
    await tx.execute(sql`update slack_link_tokens set used_at = ${now.toISOString()}::timestamptz
      where user_id = ${actor.userId} and used_at is null`);
    await tx.execute(sql`insert into slack_link_tokens (token_hash, workspace_id, user_id, expires_at)
      values (${sha256Hex(normalizeCode(code))}, ${actor.workspaceId}, ${actor.userId}, ${expiresAt.toISOString()}::timestamptz)`);
  });
  return { code, expiresAt: expiresAt.toISOString(), command: `/relay link ${code}` };
}

async function unlink(actor: Actor): Promise<{ ok: true }> {
  await withWorkspaceTx(actor.workspaceId, async (tx) => {
    await tx.execute(
      sql`update users set slack_user_id = null, slack_team_id = null, version = version + 1 where id = ${actor.userId}`,
    );
    await appendAudit(tx, actor, {
      action: 'user.slack_unlinked',
      targetType: 'user',
      targetId: actor.userId,
    });
  });
  return { ok: true };
}

// ── alerts (Lane A hook) ────────────────────────────────────────────────
export interface SlackAlertInput {
  workspaceId: string;
  userId: string;
  leadId: string;
  leadVersion: number;
  purpose: AlertPurpose;
  /** Snapshot for rendering (the handler does not read Lane A's tables). */
  leadName: string;
  source: string;
  /** Trace sentence (why this person). */
  reason: string;
  level?: number;
  deadlineAt?: Date | null;
  /** Pre-formatted opportunity value; shown ONLY if the recipient may see values (F1.4). */
  valueText?: string | null;
}

/**
 * Enqueue a Slack alert IN THE CALLER'S TRANSACTION (escalation tx, T-124). Idempotent per
 * (purpose, lead, leadVersion, user): a replay of the same transition enqueues nothing.
 * Never calls Slack; the outbox job does. Returns the alert id (null when deduped).
 */
export async function enqueueSlackAlert(tx: Tx, a: SlackAlertInput): Promise<string | null> {
  const alertId = randomBytes(9).toString('base64url'); // 12 chars
  const dedupeKey = `sl:${a.purpose}:${a.leadId}:${a.leadVersion}:${a.userId}`;
  const job = await enqueueJob(tx, {
    type: 'slack.send',
    maxAttempts: 5,
    dedupeKey,
    payload: {
      alertId,
      leadId: a.leadId,
      userId: a.userId,
      purpose: a.purpose,
      leadVersion: a.leadVersion,
      leadName: a.leadName,
      source: a.source,
      reason: a.reason,
      level: a.level ?? null,
      deadlineAt: a.deadlineAt ? a.deadlineAt.toISOString() : null,
      valueText: a.valueText ?? null,
    },
  });
  if (job.deduped) return null;
  await tx.execute(sql`insert into slack_alerts (id, workspace_id, user_id, lead_id, lead_version, purpose)
    values (${alertId}, ${a.workspaceId}, ${a.userId}, ${a.leadId}, ${a.leadVersion}, ${a.purpose})`);
  return alertId;
}

/** TEMPORARY: until core/auth/mask.ts (T-102) is merged, never reveal values in Slack (fail closed). */
async function recipientMayViewValue(_tx: Tx, _userId: string): Promise<boolean> {
  return false; // TODO(T-102): can(actorFor(user), 'crm.opportunity.value.view') via core/auth/mask.ts
}

async function logOutbound(
  tx: Tx,
  kind: string,
  ok: boolean,
  started: number,
  reference: string | null,
  error: string | null,
  connId: string | null,
) {
  await tx.execute(sql`insert into integration_events
    (workspace_id, connection_id, provider, direction, kind, status, latency_ms, reference, error, processed_at)
    values (nullif(current_setting('app.workspace_id', true), '')::uuid, ${connId}, 'slack', 'out', ${kind},
            ${ok ? 'processed' : 'failed'}, ${Date.now() - started}, ${reference}, ${error}, now())`);
}

export interface SlackSendPayload {
  alertId: string;
  leadId: string;
  userId: string;
  purpose: AlertPurpose;
  leadVersion: number;
  leadName: string;
  source: string;
  reason: string;
  level: number | null;
  deadlineAt: string | null;
  valueText: string | null;
}

/** slack.send handler body: pure function of payload + adapter (+ DB reads/writes outside the call). */
export async function sendSlackAlert(
  workspaceId: string,
  p: SlackSendPayload,
  now: Date = new Date(),
): Promise<void> {
  // 1. Read (tx closed before the provider call).
  const ctx = await withWorkspaceTx(workspaceId, async (tx) => {
    const alert = (
      await tx.execute<{ status: string }>(sql`select status from slack_alerts where id = ${p.alertId}`)
    ).rows[0];
    if (!alert || alert.status !== 'queued') return { ok: false as const };
    const user = (
      await tx.execute<{ slack_user_id: string | null; locale: string }>(
        sql`select slack_user_id, locale from users where id = ${p.userId}`,
      )
    ).rows[0];
    const conn = await ensurePlatformConnection(tx, workspaceId, 'slack');
    const creds = slackCredsFromRow(conn);
    const mayView = await recipientMayViewValue(tx, p.userId);
    const fail = async (status: 'skipped', error: string) => {
      await tx.execute(
        sql`update slack_alerts set status = ${status}, error = ${error} where id = ${p.alertId}`,
      );
      return { ok: false as const };
    };
    if (!user?.slack_user_id) return fail('skipped', 'slack_not_connected'); // visible reason (I4.4)
    if (!creds) return fail('skipped', 'slack_not_configured');
    const gate = breakerAllows(
      { state: conn.health.state, failures: conn.health.failures, openedAt: conn.health.opened_at },
      now,
    );
    return { ok: true as const, user, creds, connId: conn.id, gate, mayView };
  });
  if (!ctx.ok) return;
  if (!ctx.gate.allow) {
    // Breaker open (I5.8): do not call the provider; retry after the half-open window. Does not consume an attempt.
    throw new DeferJobError(ctx.gate.retryInMs, 'slack circuit open');
  }

  // 2. Call Slack (no tx open).
  const msg = buildAlert(
    {
      leadId: p.leadId,
      leadName: p.leadName,
      source: p.source,
      purpose: p.purpose,
      reason: p.reason,
      level: p.level ?? undefined,
      deadlineAt: p.deadlineAt ? new Date(p.deadlineAt) : null,
      valueText: maskValue(p.valueText, ctx.mayView),
      baseUrl: config.core.PUBLIC_BASE_URL,
      locale: (ctx.user.locale === 'ur' ? 'ur' : 'en') as SlackLocale,
      alertId: p.alertId,
    },
    config.core.SESSION_SECRET,
    now,
  );
  const started = Date.now();
  let sent: { channel: string; ts: string };
  try {
    sent = await getNotifier().sendAlert(ctx.user.slack_user_id!, msg, ctx.creds);
  } catch (err) {
    const pe =
      err instanceof ProviderError ? err : new ProviderError('temporary', 'unknown', 'slack send failed');
    await recordOutcome(workspaceId, 'slack', { ok: false, kind: pe.kind, code: pe.code });
    await withWorkspaceTx(workspaceId, async (tx) => {
      await logOutbound(
        tx,
        'slack.chat.postMessage',
        false,
        started,
        null,
        redactText(pe.code, 200),
        ctx.connId,
      );
      if (pe.kind !== 'temporary') {
        await tx.execute(
          sql`update slack_alerts set status = 'failed', error = ${pe.code} where id = ${p.alertId}`,
        );
        // The Slack identity is gone: clear the link so the user reconnects (04 §6).
        if (pe.code === 'user_not_found' || pe.code === 'account_inactive' || pe.code === 'user_disabled') {
          await tx.execute(
            sql`update users set slack_user_id = null, slack_team_id = null, version = version + 1 where id = ${p.userId}`,
          );
        }
      }
    });
    throw pe; // runner: temporary -> backoff (+Retry-After), permanent/auth -> failed
  }

  // 3. Record success.
  await recordOutcome(workspaceId, 'slack', { ok: true });
  await withWorkspaceTx(workspaceId, async (tx) => {
    await tx.execute(
      sql`update slack_alerts set status = 'sent', slack_channel = ${sent.channel}, slack_ts = ${sent.ts}, error = null where id = ${p.alertId}`,
    );
    await logOutbound(tx, 'slack.chat.postMessage', true, started, sent.ts, null, ctx.connId);
  });
}

export type SlackUpdatePayload =
  { kind: 'alert'; alertId: string; text: string } | { kind: 'dm'; slackUserId: string; text: string };

/** slack.update handler body: chat.update an alert (acknowledged / stale) or DM a confirmation. */
export async function sendSlackUpdate(workspaceId: string, p: SlackUpdatePayload): Promise<void> {
  const ctx = await withWorkspaceTx(workspaceId, async (tx) => {
    const conn = await ensurePlatformConnection(tx, workspaceId, 'slack');
    const alert =
      p.kind === 'alert'
        ? (
            await tx.execute<{ slack_channel: string | null; slack_ts: string | null }>(
              sql`select slack_channel, slack_ts from slack_alerts where id = ${p.alertId}`,
            )
          ).rows[0]
        : undefined;
    return { creds: slackCredsFromRow(conn), connId: conn.id, alert };
  });
  if (!ctx.creds) return;
  const started = Date.now();
  try {
    if (p.kind === 'alert') {
      if (!ctx.alert?.slack_channel || !ctx.alert.slack_ts) return;
      await getNotifier().updateAlert(
        ctx.alert.slack_channel,
        ctx.alert.slack_ts,
        buildResolved(p.text),
        ctx.creds,
      );
    } else {
      await getNotifier().sendAlert(p.slackUserId, buildResolved(p.text), ctx.creds);
    }
  } catch (err) {
    const pe = err instanceof ProviderError ? err : new ProviderError('temporary', 'unknown');
    await recordOutcome(workspaceId, 'slack', { ok: false, kind: pe.kind, code: pe.code });
    await withWorkspaceTx(workspaceId, (tx) =>
      logOutbound(
        tx,
        p.kind === 'alert' ? 'slack.chat.update' : 'slack.chat.postMessage',
        false,
        started,
        null,
        pe.code,
        ctx.connId,
      ),
    );
    throw pe;
  }
  await recordOutcome(workspaceId, 'slack', { ok: true });
}

// ── inbound processing (after verify + record) ──────────────────────────
const REPLIES = {
  en: {
    help: 'Relay commands:\n• `/relay link <code>`: connect your Slack to Relay (get the code in your Relay profile)\n• `/relay help`',
    linked: 'Slack connected. Lead alerts will arrive here as direct messages.',
    badCode: 'That code is invalid or has expired. Generate a new one in your Relay profile.',
    taken: 'This Slack account is already connected to another Relay user.',
    wrongUser: 'This alert is not assigned to you.',
    notLinked: 'Your Slack account is not connected to Relay.',
    ackSoon: 'Acknowledging from Slack is coming soon. Open the lead in Relay to acknowledge it.',
    unknown: 'Unknown action.',
  },
  ur: {
    help: 'Relay کمانڈز:\n• `/relay link <code>`: اپنا Slack Relay سے جوڑیں (کوڈ Relay پروفائل میں ملے گا)\n• `/relay help`',
    linked: 'Slack جڑ گیا۔ لیڈ الرٹس یہاں براہِ راست پیغام میں آئیں گے۔',
    badCode: 'یہ کوڈ غلط ہے یا ختم ہو چکا ہے۔ Relay پروفائل میں نیا کوڈ بنائیں۔',
    taken: 'یہ Slack اکاؤنٹ پہلے ہی کسی اور Relay صارف سے جڑا ہے۔',
    wrongUser: 'یہ الرٹ آپ کو تفویض نہیں ہے۔',
    notLinked: 'آپ کا Slack اکاؤنٹ Relay سے جڑا نہیں ہے۔',
    ackSoon: 'Slack سے تصدیق جلد آ رہی ہے۔ تصدیق کے لیے Relay میں لیڈ کھولیں۔',
    unknown: 'نامعلوم عمل۔',
  },
} as const;
type ReplyKey = keyof (typeof REPLIES)['en'];
const reply = (locale: string | null | undefined, k: ReplyKey) => REPLIES[locale === 'ur' ? 'ur' : 'en'][k];

export interface InteractionCtx {
  workspaceId: string;
  alertId: string;
  userId: string; // Relay user (the alert's recipient, verified to be the Slack presser)
  slackUserId: string;
  locale: string;
}
export type InteractionHandler = (c: InteractionCtx) => Promise<string>;

/** action_id -> handler. T-203 registers the real `lead_ack`; until then it answers "coming soon". */
export const interactionHandlers = new Map<string, InteractionHandler>([
  ['lead_ack', async (c) => reply(c.locale, 'ackSoon')],
]);

type EventRow = {
  id: string;
  kind: string;
  workspace_id: string | null;
  normalized: Loose | null;
};

async function finish(
  eventId: string,
  workspaceId: string | null,
  status: 'processed' | 'failed' | 'ignored',
  error?: string,
) {
  const run = (tx: Tx) =>
    tx.execute(
      sql`update integration_events set status = ${status}, error = ${error ?? null}, processed_at = now() where id = ${eventId}`,
    );
  await (workspaceId ? withWorkspaceTx(workspaceId, run) : withSystemTx(run));
}

/** `integration.process` for Slack events. Idempotent: an already-processed event is a no-op. */
export async function processSlackEvent(eventId: string, workspaceId: string | null): Promise<void> {
  const ev = await (workspaceId
    ? withWorkspaceTx(workspaceId, readEvent(eventId))
    : withSystemTx(readEvent(eventId)));
  if (!ev || ev.status !== 'received' || !ev.normalized) return;
  const n = ev.normalized;
  let replyText: string | null = null;
  let resolvedWs = workspaceId;
  try {
    if (ev.kind === 'slack.command') {
      const out = await processCommand(n);
      replyText = out.reply;
      resolvedWs = out.workspaceId ?? workspaceId;
    } else if (ev.kind === 'slack.interaction') {
      const out = await processInteraction(n);
      replyText = out.reply;
      resolvedWs = out.workspaceId ?? workspaceId;
    }
    if (resolvedWs && !workspaceId) {
      await withSystemTx((tx) =>
        tx.execute(sql`select integration_event_attribute(${eventId}::uuid, ${resolvedWs}::uuid)`),
      );
    }
    await finish(eventId, resolvedWs, 'processed');
  } catch (err) {
    log.error('slack.process_failed', { eventId, err });
    await finish(eventId, workspaceId, 'failed', redactText(String((err as Error).message), 200));
    return;
  }
  // Best-effort ephemeral reply, after all transactions are closed.
  if (replyText && typeof n.responseUrl === 'string' && n.responseUrl) {
    try {
      await getNotifier().respond(n.responseUrl, replyText);
    } catch (err) {
      log.warn('slack.respond_failed', { eventId, err });
    }
  }
}

const readEvent =
  (eventId: string) =>
  async (tx: Tx): Promise<(EventRow & { status: string }) | undefined> =>
    (
      await tx.execute<EventRow & { status: string }>(
        sql`select id, kind, workspace_id, status, normalized from integration_events where id = ${eventId}`,
      )
    ).rows[0];

async function processCommand(n: Loose): Promise<{ reply: string; workspaceId: string | null }> {
  if (n.sub !== 'link') return { reply: reply('en', 'help'), workspaceId: null };
  if (!n.codeHash) return { reply: reply('en', 'help'), workspaceId: null };
  const found = await withSystemTx(
    async (tx) =>
      (
        await tx.execute<{ workspace_id: string; user_id: string }>(
          sql`select * from slack_link_lookup(${n.codeHash})`,
        )
      ).rows[0],
  );
  if (!found) return { reply: reply('en', 'badCode'), workspaceId: null };
  const ws = found.workspace_id;
  const result = await withWorkspaceTx(ws, async (tx) => {
    // Single use: only one concurrent redemption can flip used_at.
    const used = await tx.execute<{ user_id: string }>(sql`update slack_link_tokens set used_at = now()
      where token_hash = ${n.codeHash} and used_at is null and expires_at > now() returning user_id`);
    const uid = used.rows[0]?.user_id;
    if (!uid) return { key: 'badCode' as const, locale: 'en' };
    const user = (
      await tx.execute<{ locale: string }>(sql`select locale from users where id = ${uid} and is_active`)
    ).rows[0];
    if (!user) return { key: 'badCode' as const, locale: 'en' };
    const clash = await tx.execute(
      sql`select 1 from users where slack_user_id = ${n.userId} and slack_team_id = ${n.teamId} and id <> ${uid}`,
    );
    if (clash.rows.length) return { key: 'taken' as const, locale: user.locale };
    await tx.execute(
      sql`update users set slack_user_id = ${n.userId}, slack_team_id = ${n.teamId}, version = version + 1 where id = ${uid}`,
    );
    await appendAudit(
      tx,
      { type: 'system', workspaceId: ws },
      { action: 'user.slack_linked', targetType: 'user', targetId: uid, after: { slackTeamId: n.teamId } },
    );
    // DM confirmation in the user's locale goes through the outbox (no Slack call here).
    await enqueueJob(tx, {
      type: 'slack.update',
      maxAttempts: 3,
      dedupeKey: `slu:link:${uid}:${sha256Hex(String(n.codeHash)).slice(0, 12)}`,
      payload: { kind: 'dm', slackUserId: n.userId, text: reply(user.locale, 'linked') },
    });
    return { key: 'linked' as const, locale: user.locale };
  });
  return { reply: reply(result.locale, result.key), workspaceId: ws };
}

async function processInteraction(n: Loose): Promise<{ reply: string | null; workspaceId: string | null }> {
  const action = n.action as { actionId: string; value: string } | null;
  if (!action) return { reply: null, workspaceId: null };
  const handler = interactionHandlers.get(action.actionId);
  if (!handler)
    return { reply: action.actionId === 'open_lead' ? null : reply('en', 'unknown'), workspaceId: null };
  const alertId = verifyAlertValue(action.value, config.core.SESSION_SECRET);
  if (!alertId) return { reply: reply('en', 'unknown'), workspaceId: null };
  const found = await withSystemTx(
    async (tx) =>
      (
        await tx.execute<{ workspace_id: string; user_id: string }>(
          sql`select * from slack_alert_lookup(${alertId})`,
        )
      ).rows[0],
  );
  if (!found) return { reply: reply('en', 'unknown'), workspaceId: null };
  const ws = found.workspace_id;
  const user = await withWorkspaceTx(
    ws,
    async (tx) =>
      (
        await tx.execute<{ locale: string; slack_user_id: string | null }>(
          sql`select locale, slack_user_id from users where id = ${found.user_id}`,
        )
      ).rows[0],
  );
  if (!user || user.slack_user_id !== n.userId)
    return { reply: reply(user?.locale, 'wrongUser'), workspaceId: ws };
  const text = await handler({
    workspaceId: ws,
    alertId,
    userId: found.user_id,
    slackUserId: n.userId,
    locale: user.locale,
  });
  return { reply: text, workspaceId: ws };
}

export const slackService = { linkStatus, createLinkCode, unlink };
