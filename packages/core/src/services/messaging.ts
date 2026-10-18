// Messaging service (T-141/T-142; I1.3-I1.11). Owner: Lane C.
//  - inbound: `integration.process` -> processWhatsAppEvent (contact match, conversation, message, intake hook)
//  - outbound: composer -> `messages` row (queued) + outbox `whatsapp.send` -> deliverMessage (provider call
//    OUTSIDE any tx) -> sent/failed; status webhooks move it forward only (sent < delivered < read)
//  - 24 h window (I1.10) + opt-out (I1.9) enforced in the service AND again in the job (defense in depth)
//  - media (I1.11): `media.download` job -> Blob (or Postgres fallback) -> authed proxy
// Provider calls never happen inside a DB transaction.
import { createHash } from 'node:crypto';
import {
  FAILURE_REASONS,
  type ConversationDto,
  type MessageDto,
  type SendMessageInput,
  type TemplateDto,
} from '@relay/contracts/api/messaging';
import { withWorkspaceTx, type Tx } from '@relay/db';
import { sql, type SQL } from 'drizzle-orm';
import * as audit from '../audit';
import type { Actor } from '../auth/actor';
import { assertPermission, can } from '../auth/permissions';
import { contactScopeSql } from '../auth/visibility';
import { config } from '../config';
import { AppError, notFound } from '../errors';
import { breakerAllows } from '../integrations/breaker';
import { classifyMetaError } from '../integrations/meta/adapter';
import { putMedia } from '../integrations/blob';
import { redactText } from '../integrations/redact';
import { getMessaging } from '../integrations/registry';
import { ProviderError, type Creds, type ParsedMessagingEvent } from '../integrations/types';
import { enqueueJob } from '../integrations/upstream';
import { DeferJobError, PermanentJobError } from '../jobs/policy';
import { log } from '../log';
import { emit } from '../realtime';
import { decryptCreds, ensurePlatformConnection, recordOutcome } from './integrations';
import { runInboundHandlers, runOutboundHumanMessageHandlers } from './messaging-hooks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

export const WINDOW_MS = 24 * 3600_000;
const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : new Date(d).toISOString();

// ── credentials ─────────────────────────────────────────────────────────
type ConnLike = {
  id: string;
  secrets_enc: string | null;
  public_config: Record<string, string>;
  status: string;
};

/** Workspace-owned (encrypted) credentials if the connection has secrets, else the platform META_* env. */
export function waCredsFromRow(row: ConnLike | null): Creds {
  const w = config.whatsapp;
  const graphVersion = w.META_GRAPH_VERSION ?? '';
  if (row?.secrets_enc && row.status !== 'not_connected') {
    return { graphVersion, ...decryptCreds(row) };
  }
  const c: Creds = { graphVersion };
  if (w.META_ACCESS_TOKEN) c.accessToken = w.META_ACCESS_TOKEN;
  if (w.META_APP_SECRET) c.appSecret = w.META_APP_SECRET;
  if (w.META_VERIFY_TOKEN) c.verifyToken = w.META_VERIFY_TOKEN;
  if (w.META_PHONE_NUMBER_ID) c.phoneNumberId = w.META_PHONE_NUMBER_ID;
  if (w.META_WABA_ID) c.wabaId = w.META_WABA_ID;
  return c;
}

// ── templates (I1.10) ───────────────────────────────────────────────────
const BUILTIN_TEMPLATES: TemplateDto[] = [
  // Ships with every Meta test number.
  { key: 'hello_world', name: 'hello_world', lang: 'en_US', body: 'Hello World', paramCount: 0 },
];

const paramCountOf = (body: string) => new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
const render = (body: string, params: string[]) =>
  body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');

async function loadTemplates(tx: Tx): Promise<TemplateDto[]> {
  const rows = (
    await tx.execute<Loose>(
      sql`select key, body, wa_template_name, wa_template_lang from message_templates where wa_template_name is not null order by key`,
    )
  ).rows;
  const fromDb: TemplateDto[] = rows.map((r) => ({
    key: r.key,
    name: r.wa_template_name,
    lang: r.wa_template_lang ?? 'en_US',
    body: r.body,
    paramCount: paramCountOf(r.body),
  }));
  const keys = new Set(fromDb.map((t) => t.key));
  return [...fromDb, ...BUILTIN_TEMPLATES.filter((t) => !keys.has(t.key))];
}

// ── visibility ──────────────────────────────────────────────────────────
/** Conversation record scope (F1.5): everything with leads.view_all, else assigned to me or my contacts. */
export async function scopeSql(tx: Tx, actor: Actor, alias: string): Promise<SQL> {
  if (can(actor, 'leads.view_all')) return sql`true`;
  const t = (
    await tx.execute<{ c: string | null; l: string | null }>(
      sql`select to_regclass('public.contacts') c, to_regclass('public.leads') l`,
    )
  ).rows[0];
  const col = sql.raw(`${alias}.contact_id`);
  const viaContact = t?.c && t.l ? contactScopeSql(actor, col) : sql`false`;
  return sql`(${sql.raw(alias)}.assigned_user_id = ${actor.userId} or (${col} is not null and ${viaContact}))`;
}

// ── DTO mapping ─────────────────────────────────────────────────────────
function toConversationDto(r: Loose, now: Date): ConversationDto {
  const closesAt = r.last_inbound_at ? new Date(new Date(r.last_inbound_at).getTime() + WINDOW_MS) : null;
  return {
    id: r.id,
    contactId: r.contact_id,
    phone: r.external_key,
    name: r.display_name,
    assignedUserId: r.assigned_user_id,
    lastMessageAt: iso(r.last_message_at),
    preview: r.last_message_preview,
    unreadCount: r.unread_count,
    windowOpen: !!closesAt && now < closesAt,
    windowClosesAt: closesAt && now < closesAt ? closesAt.toISOString() : null,
    optedOut: r.opted_out,
    optOutSuggested: !!r.opt_out_suggested_at && !r.opted_out,
    hasFailed: !!r.has_failed,
  };
}

function toMessageDto(r: Loose): MessageDto {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction,
    authorType: r.author_type,
    authorUserId: r.author_user_id,
    kind: r.kind,
    body: r.body,
    templateName: r.template_name,
    status: r.status,
    statusReason: r.status_reason,
    statusDetail: r.status_detail,
    media: r.media_id
      ? {
          id: r.media_id,
          mime: r.media_mime,
          filename: r.media_filename,
          sizeBytes: r.media_size ?? 0,
          url: `/api/v1/media/${r.media_id}`,
        }
      : null,
    transcript: r.transcript ?? null,
    transcriptStatus: r.transcript_status ?? 'none',
    summary: r.summary ?? null,
    createdAt: iso(r.created_at)!,
  };
}

const MSG_SELECT = sql`select m.*, md.mime media_mime, md.filename media_filename, md.size_bytes media_size
  from messages m left join media md on md.id = m.media_id`;

const CONV_SELECT = (scope: SQL) => sql`select c.*,
  exists (select 1 from messages f where f.conversation_id = c.id and f.direction = 'out' and f.status = 'failed') has_failed
  from conversations c where ${scope}`;

async function loadConversation(tx: Tx, actor: Actor, id: string): Promise<Loose> {
  const scope = await scopeSql(tx, actor, 'c');
  const r = (await tx.execute<Loose>(sql`${CONV_SELECT(scope)} and c.id = ${id}`)).rows[0];
  if (!r) throw notFound(); // other workspace (RLS) or out of scope -> 404
  return r;
}

// ── reads ───────────────────────────────────────────────────────────────
async function listConversations(
  actor: Actor,
  q: { filter: 'all' | 'unread' | 'failed'; before?: string; limit: number },
  now: Date = new Date(),
) {
  assertPermission(actor, 'crm.contact.view');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const scope = await scopeSql(tx, actor, 'c');
    const res = await tx.execute<Loose>(sql`select * from (${CONV_SELECT(scope)}) c
      where (${q.before ?? null}::timestamptz is null or c.last_message_at < ${q.before ?? null}::timestamptz)
        and (${q.filter} <> 'unread' or c.unread_count > 0)
        and (${q.filter} <> 'failed' or c.has_failed)
      order by c.last_message_at desc nulls last, c.id limit ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    return {
      conversations: rows.map((r) => toConversationDto(r, now)),
      nextBefore: res.rows.length > q.limit ? iso(rows[rows.length - 1]!.last_message_at) : null,
    };
  });
}

async function listMessages(
  actor: Actor,
  conversationId: string,
  q: { before?: string; limit: number },
  now: Date = new Date(),
) {
  assertPermission(actor, 'crm.contact.view');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const conv = await loadConversation(tx, actor, conversationId);
    const res = await tx.execute<Loose>(sql`${MSG_SELECT}
      where m.conversation_id = ${conversationId}
        and (${q.before ?? null}::timestamptz is null or m.created_at < ${q.before ?? null}::timestamptz)
      order by m.created_at desc, m.id desc limit ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    return {
      conversation: toConversationDto(conv, now),
      messages: rows.reverse().map(toMessageDto),
      nextBefore: res.rows.length > q.limit ? iso(rows[0]!.created_at) : null,
    };
  });
}

async function listTemplates(actor: Actor): Promise<{ templates: TemplateDto[] }> {
  assertPermission(actor, 'crm.contact.view');
  return withWorkspaceTx(actor.workspaceId, async (tx) => ({ templates: await loadTemplates(tx) }));
}

async function markRead(actor: Actor, conversationId: string): Promise<{ ok: true }> {
  assertPermission(actor, 'crm.contact.view');
  await withWorkspaceTx(actor.workspaceId, async (tx) => {
    await loadConversation(tx, actor, conversationId);
    await tx.execute(
      sql`update conversations set unread_count = 0 where id = ${conversationId} and unread_count > 0`,
    );
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'conversations', ids: [conversationId] });
  });
  return { ok: true };
}

// ── send (I1.3, I1.9, I1.10) ────────────────────────────────────────────
const businessRule = (reason: string) => new AppError('BUSINESS_RULE_VIOLATION', { details: { reason } });

async function send(
  actor: Actor,
  conversationId: string,
  input: SendMessageInput,
  now: Date = new Date(),
): Promise<MessageDto> {
  assertPermission(actor, 'messaging.send');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const conv = await loadConversation(tx, actor, conversationId);
    if (input.clientKey) {
      const dup = (
        await tx.execute<Loose>(
          sql`${MSG_SELECT} where m.conversation_id = ${conversationId} and m.client_key = ${input.clientKey}`,
        )
      ).rows[0];
      if (dup) return toMessageDto(dup); // idempotent submit
    }
    if (conv.opted_out) throw businessRule('opted_out'); // I1.9
    const open =
      !!conv.last_inbound_at && now.getTime() < new Date(conv.last_inbound_at).getTime() + WINDOW_MS;

    let kind: 'text' | 'template' = 'text';
    let body: string;
    let tpl: { name: string; lang: string; key: string; params: string[] } | null = null;
    if (input.kind === 'text') {
      if (!open) throw businessRule('window_closed'); // I1.10: free text only inside the window
      body = input.text;
    } else {
      const t = (await loadTemplates(tx)).find((x) => x.key === input.templateKey);
      if (!t) throw notFound();
      if (input.params.length !== t.paramCount) throw businessRule('template_params');
      kind = 'template';
      body = render(t.body, input.params);
      tpl = { name: t.name, lang: t.lang, key: t.key, params: input.params };
    }
    const ins = await tx.execute<Loose>(sql`insert into messages
      (workspace_id, conversation_id, direction, author_type, author_user_id, kind, body, template_key, template_name,
       template_lang, template_params, status, status_at, client_key)
      values (${actor.workspaceId}, ${conversationId}, 'out', 'user', ${actor.userId}, ${kind}, ${body},
              ${tpl?.key ?? null}, ${tpl?.name ?? null}, ${tpl?.lang ?? null},
              ${tpl ? JSON.stringify(tpl.params) : null}::jsonb, 'queued', ${now.toISOString()}::timestamptz,
              ${input.clientKey ?? null})
      returning id`);
    const id = ins.rows[0]!.id as string;
    await touchConversation(tx, conversationId, body, now);
    // Lane A: an owner's message acknowledges the lead; any human message ends the AI stand-in (F2.13, F6.10).
    await runOutboundHumanMessageHandlers(
      tx,
      {
        workspaceId: actor.workspaceId,
        conversationId,
        contactId: conv.contact_id ?? null,
        messageId: id,
        userId: actor.userId,
      },
      actor,
    );
    await enqueueJob(tx, {
      type: 'whatsapp.send',
      payload: { messageId: id },
      dedupeKey: `wa:send:${id}:0`,
      maxAttempts: 6,
    });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'messages', ids: [id] });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'conversations', ids: [conversationId] });
    const row = (await tx.execute<Loose>(sql`${MSG_SELECT} where m.id = ${id}`)).rows[0]!;
    return toMessageDto(row);
  });
}

async function touchConversation(tx: Tx, conversationId: string, preview: string | null, at: Date) {
  await tx.execute(sql`update conversations set last_message_at = greatest(coalesce(last_message_at, ${at.toISOString()}::timestamptz), ${at.toISOString()}::timestamptz),
    last_message_preview = ${preview ? preview.slice(0, 140) : null}, version = version + 1 where id = ${conversationId}`);
}

async function retry(actor: Actor, conversationId: string, messageId: string): Promise<MessageDto> {
  assertPermission(actor, 'messaging.send');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const conv = await loadConversation(tx, actor, conversationId);
    if (conv.opted_out) throw businessRule('opted_out');
    const r = (
      await tx.execute<Loose>(sql`update messages set status = 'queued', status_reason = null, status_detail = null,
        status_at = now(), retry_count = retry_count + 1
        where id = ${messageId} and conversation_id = ${conversationId} and direction = 'out' and status = 'failed'
        returning id, retry_count`)
    ).rows[0];
    if (!r) throw businessRule('not_retryable');
    await enqueueJob(tx, {
      type: 'whatsapp.send',
      payload: { messageId },
      dedupeKey: `wa:send:${messageId}:${r.retry_count}`,
      maxAttempts: 6,
    });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'messages', ids: [messageId] });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'conversations', ids: [conversationId] });
    return toMessageDto((await tx.execute<Loose>(sql`${MSG_SELECT} where m.id = ${messageId}`)).rows[0]!);
  });
}

async function setOptOut(
  actor: Actor,
  conversationId: string,
  optedOut: boolean,
  now: Date = new Date(),
): Promise<ConversationDto> {
  assertPermission(actor, 'messaging.send');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const conv = await loadConversation(tx, actor, conversationId);
    await tx.execute(sql`update conversations set opted_out = ${optedOut},
      opted_out_at = ${optedOut ? now.toISOString() : null}::timestamptz, version = version + 1 where id = ${conversationId}`);
    if (conv.contact_id) {
      const t = (await tx.execute<{ c: string | null }>(sql`select to_regclass('public.contacts') c`)).rows[0]
        ?.c;
      if (t) {
        await tx.execute(sql`update contacts set opted_out = ${optedOut},
          opted_out_at = ${optedOut ? now.toISOString() : null}::timestamptz, version = version + 1 where id = ${conv.contact_id}`);
      }
    }
    await audit.append(tx, actor, {
      action: 'contact.opted_out',
      targetType: conv.contact_id ? 'contact' : 'conversation',
      targetId: conv.contact_id ?? conversationId,
      after: { optedOut },
    });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'conversations', ids: [conversationId] });
    return toConversationDto(await loadConversation(tx, actor, conversationId), now);
  });
}

// ── outbound delivery (outbox job whatsapp.send) ────────────────────────
const reasonOf = (code: string): string =>
  (FAILURE_REASONS as readonly string[]).includes(code) ? code : 'unknown';

async function logOutbound(
  tx: Tx,
  ok: boolean,
  started: number,
  ref: string | null,
  error: string | null,
  connId: string | null,
) {
  await tx.execute(sql`insert into integration_events
    (workspace_id, connection_id, provider, direction, kind, status, latency_ms, reference, error, processed_at)
    values (nullif(current_setting('app.workspace_id', true), '')::uuid, ${connId}, 'meta_whatsapp', 'out',
            'whatsapp.send', ${ok ? 'processed' : 'failed'}, ${Date.now() - started}, ${ref}, ${error}, now())`);
}

async function markFailed(
  tx: Tx,
  workspaceId: string,
  messageId: string,
  conversationId: string,
  reason: string,
  detail?: string,
) {
  await tx.execute(sql`update messages set status = 'failed', status_reason = ${reason},
    status_detail = ${detail ? redactText(detail, 200) : null}, status_at = now()
    where id = ${messageId} and status in ('queued', 'sending')`);
  await emit(tx, { workspaceId, topic: 'messages', ids: [messageId] });
  await emit(tx, { workspaceId, topic: 'conversations', ids: [conversationId] });
}

export async function deliverMessage(
  workspaceId: string,
  messageId: string,
  jobCtx: { attempt: number; maxAttempts: number; now: Date },
): Promise<void> {
  // 1. Read + gate (tx closed before the provider call).
  const pre = await withWorkspaceTx(workspaceId, async (tx) => {
    const m = (
      await tx.execute<Loose>(sql`select m.*, c.external_key, c.opted_out, c.last_inbound_at
        from messages m join conversations c on c.id = m.conversation_id where m.id = ${messageId} for update of m`)
    ).rows[0];
    if (!m || m.direction !== 'out' || !['queued', 'sending'].includes(m.status))
      return { skip: true as const };
    const conn = await ensurePlatformConnection(tx, workspaceId, 'meta_whatsapp');
    const creds = waCredsFromRow(conn);
    // Defense in depth (I1.9, I1.10): re-check what the service checked.
    if (m.opted_out) {
      await markFailed(tx, workspaceId, messageId, m.conversation_id, 'opted_out');
      return { skip: true as const };
    }
    const open =
      !!m.last_inbound_at && jobCtx.now.getTime() < new Date(m.last_inbound_at).getTime() + WINDOW_MS;
    if (m.kind === 'text' && !open) {
      await markFailed(tx, workspaceId, messageId, m.conversation_id, 'window_closed');
      return { skip: true as const };
    }
    if (!creds.accessToken || !creds.phoneNumberId) {
      await markFailed(tx, workspaceId, messageId, m.conversation_id, 'not_connected');
      return { skip: true as const };
    }
    const gate = breakerAllows(
      { state: conn.health.state, failures: conn.health.failures, openedAt: conn.health.opened_at },
      jobCtx.now,
    );
    if (gate.allow) {
      await tx.execute(
        sql`update messages set status = 'sending', status_at = now() where id = ${messageId}`,
      );
    }
    return { skip: false as const, m, creds, connId: conn.id, gate };
  });
  if (pre.skip) return;
  if (!pre.gate.allow) {
    // Breaker open (I5.8): deferred, not dropped; does not consume an attempt.
    throw new DeferJobError(pre.gate.retryInMs, 'whatsapp circuit open');
  }

  // 2. Provider call (no tx open).
  const { m, creds } = pre;
  const started = Date.now();
  let providerMessageId: string;
  try {
    const wa = getMessaging();
    providerMessageId = (
      m.kind === 'template'
        ? await wa.sendTemplate(
            m.external_key,
            {
              name: m.template_name,
              lang: m.template_lang ?? 'en_US',
              params: (m.template_params as string[] | null) ?? [],
            },
            creds,
          )
        : await wa.sendText(m.external_key, m.body ?? '', creds)
    ).providerMessageId;
  } catch (err) {
    const pe =
      err instanceof ProviderError ? err : new ProviderError('temporary', 'unknown', 'whatsapp send failed');
    await recordOutcome(workspaceId, 'meta_whatsapp', { ok: false, kind: pe.kind, code: pe.code });
    const final = pe.kind !== 'temporary' || jobCtx.attempt >= jobCtx.maxAttempts;
    await withWorkspaceTx(workspaceId, async (tx) => {
      await logOutbound(tx, false, started, null, redactText(pe.message, 200), pre.connId);
      if (final)
        await markFailed(tx, workspaceId, messageId, m.conversation_id, reasonOf(pe.code), pe.message);
      else {
        // Visible "retrying" state; the outbox backs off and re-delivers (I1.7).
        await tx.execute(
          sql`update messages set status = 'queued', status_reason = ${reasonOf(pe.code)}, status_at = now() where id = ${messageId} and status = 'sending'`,
        );
        await emit(tx, { workspaceId, topic: 'messages', ids: [messageId] });
      }
    });
    throw pe; // runner: temporary -> backoff, permanent/auth -> failed
  }

  // 3. Record success. A status webhook may already be waiting for this id (it retries until we record it).
  await recordOutcome(workspaceId, 'meta_whatsapp', { ok: true });
  await withWorkspaceTx(workspaceId, async (tx) => {
    await tx.execute(sql`update messages set provider_message_id = ${providerMessageId},
      status = case when wa_status_rank(status) < 2 then 'sent' else status end,
      status_reason = null, status_detail = null, status_at = now(), sent_at = now() where id = ${messageId}`);
    await logOutbound(tx, true, started, providerMessageId, null, pre.connId);
    await emit(tx, { workspaceId, topic: 'messages', ids: [messageId] });
  });
}

// ── inbound processing (after verify + record) ──────────────────────────
const OPT_OUT = /^\s*(stop|stop all|unsubscribe|cancel|band\s*kar[oa]?|band\s*kro|بند|بند کرو)\s*[.!]*\s*$/iu;
export const looksLikeOptOut = (text: string | null | undefined): boolean => !!text && OPT_OUT.test(text);

async function findContactByPhone(
  tx: Tx,
  phone: string,
): Promise<{ id: string; name: string | null } | null> {
  const t = (await tx.execute<{ c: string | null }>(sql`select to_regclass('public.contacts') c`)).rows[0]?.c;
  if (!t) return null; // contacts (Lane B) not migrated yet: the intake hook resolves/creates the contact
  const r = (
    await tx.execute<Loose>(
      sql`select id, name from contacts where phone_e164 = ${phone} and deleted_at is null limit 1`,
    )
  ).rows[0];
  return r ? { id: r.id, name: r.name } : null;
}

async function applyInbound(
  tx: Tx,
  workspaceId: string,
  ev: Extract<ParsedMessagingEvent, { type: 'inbound' }>,
  connId: string | null,
) {
  const contact = await findContactByPhone(tx, ev.from);
  const conv = (
    await tx.execute<Loose>(sql`insert into conversations (workspace_id, contact_id, external_key, display_name, connection_id)
      values (${workspaceId}, ${contact?.id ?? null}, ${ev.from}, ${ev.profileName ?? null}, ${connId})
      on conflict (workspace_id, channel, external_key) do update
        set display_name = coalesce(excluded.display_name, conversations.display_name),
            contact_id = coalesce(conversations.contact_id, excluded.contact_id)
      returning id, contact_id`)
  ).rows[0]!;
  const kind = ev.kind === 'other' ? 'text' : ev.kind;
  const ins = await tx.execute<Loose>(sql`insert into messages
    (workspace_id, conversation_id, direction, author_type, kind, body, provider_message_id, status, status_at, created_at, transcript_status)
    values (${workspaceId}, ${conv.id}, 'in', 'customer', ${kind}, ${ev.text ?? null}, ${ev.externalEventId},
            'delivered', ${ev.at.toISOString()}::timestamptz, ${ev.at.toISOString()}::timestamptz,
            ${ev.kind === 'audio' ? 'pending' : 'none'})
    on conflict (workspace_id, provider_message_id) where provider_message_id is not null do nothing
    returning id`);
  const messageId = ins.rows[0]?.id as string | undefined;
  if (!messageId) return; // duplicate wamid (I1.8): already stored
  const suggest = looksLikeOptOut(ev.text);
  await tx.execute(sql`update conversations set
    last_inbound_at = greatest(coalesce(last_inbound_at, ${ev.at.toISOString()}::timestamptz), ${ev.at.toISOString()}::timestamptz),
    last_message_at = greatest(coalesce(last_message_at, ${ev.at.toISOString()}::timestamptz), ${ev.at.toISOString()}::timestamptz),
    last_message_preview = ${(ev.text ?? `[${ev.kind}]`).slice(0, 140)},
    unread_count = unread_count + 1,
    opt_out_suggested_at = case when ${suggest} then now() else opt_out_suggested_at end,
    version = version + 1
    where id = ${conv.id}`);
  if (ev.providerMediaId) {
    await enqueueJob(tx, {
      type: 'media.download',
      payload: {
        messageId,
        providerMediaId: ev.providerMediaId,
        mime: ev.mime ?? null,
        filename: ev.filename ?? null,
      },
      dedupeKey: `wa:media:${messageId}`,
      maxAttempts: 5,
    });
  }
  // Lane A intake (contact create + lead + assignment) in the same tx; absent handler = store only.
  const res = await runInboundHandlers(tx, {
    workspaceId,
    contactId: conv.contact_id ?? contact?.id ?? null,
    phone: ev.from,
    name: ev.profileName ?? null,
    text: ev.text ?? null,
    conversationId: conv.id,
    messageId,
    at: ev.at,
  });
  if (res.contactId && res.contactId !== conv.contact_id) {
    await tx.execute(sql`update conversations set contact_id = ${res.contactId} where id = ${conv.id}`);
  }
  await emit(tx, { workspaceId, topic: 'messages', ids: [messageId] });
  await emit(tx, { workspaceId, topic: 'conversations', ids: [conv.id] });
}

async function applyStatus(
  tx: Tx,
  workspaceId: string,
  ev: Extract<ParsedMessagingEvent, { type: 'status' }>,
): Promise<boolean> {
  let rows: Loose[];
  if (ev.status === 'failed') {
    const cls = classifyMetaError(ev.errorCode);
    rows = (
      await tx.execute<Loose>(sql`update messages set status = 'failed', status_reason = ${cls.reason},
        status_detail = ${ev.errorTitle ? redactText(`${ev.errorCode ?? ''} ${ev.errorTitle}`.trim(), 200) : null},
        status_at = ${ev.at.toISOString()}::timestamptz
        where workspace_id = ${workspaceId} and provider_message_id = ${ev.providerMessageId}
          and direction = 'out' and wa_status_rank(status) < 3 and status <> 'failed'
        returning id, conversation_id`)
    ).rows;
  } else {
    rows = (
      await tx.execute<Loose>(sql`update messages set status = ${ev.status}, status_at = ${ev.at.toISOString()}::timestamptz,
        status_reason = null, status_detail = null
        where workspace_id = ${workspaceId} and provider_message_id = ${ev.providerMessageId}
          and direction = 'out' and status <> 'failed' and wa_status_rank(status) < wa_status_rank(${ev.status})
        returning id, conversation_id`)
    ).rows;
  }
  if (rows.length) {
    await emit(tx, { workspaceId, topic: 'messages', ids: rows.map((r) => r.id) });
    await emit(tx, {
      workspaceId,
      topic: 'conversations',
      ids: [...new Set(rows.map((r) => r.conversation_id as string))],
    });
    return true;
  }
  // Nothing updated: either stale/out-of-order (fine) or the send job has not recorded the wamid yet.
  const known = await tx.execute(
    sql`select 1 from messages where workspace_id = ${workspaceId} and provider_message_id = ${ev.providerMessageId}`,
  );
  return known.rows.length > 0;
}

/** `integration.process` for WhatsApp events. Idempotent: an already-processed event is a no-op. */
export async function processWhatsAppEvent(
  eventId: string,
  workspaceId: string | null,
  last = false,
): Promise<void> {
  if (!workspaceId) return;
  const finish = (tx: Tx, status: 'processed' | 'ignored' | 'failed', error?: string) =>
    tx.execute(sql`update integration_events set status = ${status}, error = ${error ?? null}, processed_at = now(),
      normalized = coalesce(normalized, '{}'::jsonb) - 'text' where id = ${eventId}`); // keep no message bodies in sync history
  try {
    await withWorkspaceTx(workspaceId, async (tx) => {
      const row = (
        await tx.execute<Loose>(
          sql`select status, normalized, connection_id from integration_events where id = ${eventId} for update`,
        )
      ).rows[0];
      if (!row || row.status !== 'received' || !row.normalized) return;
      const n = row.normalized as Loose;
      const ev = { ...n, at: new Date(n.at) } as ParsedMessagingEvent;
      if (ev.type === 'inbound') {
        await applyInbound(tx, workspaceId, ev, row.connection_id);
        await finish(tx, 'processed');
      } else {
        const known = await applyStatus(tx, workspaceId, ev);
        if (known) await finish(tx, 'processed');
        else if (last) await finish(tx, 'ignored', 'unknown_message');
        else throw new Error('message_not_recorded_yet'); // retried by the outbox with backoff
      }
    });
  } catch (err) {
    if (last) {
      await withWorkspaceTx(workspaceId, (tx) =>
        finish(tx, 'failed', redactText(String((err as Error).message), 200)),
      );
    }
    log.warn('whatsapp.process_failed', { eventId, err });
    throw err;
  }
}

// ── media (T-142, I1.11) ────────────────────────────────────────────────
export async function downloadInboundMedia(
  workspaceId: string,
  p: { messageId: string; providerMediaId: string; mime: string | null; filename: string | null },
): Promise<void> {
  const pre = await withWorkspaceTx(workspaceId, async (tx) => {
    const m = (await tx.execute<Loose>(sql`select media_id from messages where id = ${p.messageId}`)).rows[0];
    if (!m || m.media_id) return null; // gone or already downloaded
    const conn = await ensurePlatformConnection(tx, workspaceId, 'meta_whatsapp');
    return waCredsFromRow(conn);
  });
  if (!pre) return;
  let dl: { bytes: Uint8Array; mime: string };
  try {
    dl = await getMessaging().downloadMedia(p.providerMediaId, pre);
  } catch (err) {
    if (err instanceof ProviderError)
      await recordOutcome(workspaceId, 'meta_whatsapp', { ok: false, kind: err.kind, code: err.code });
    throw err;
  }
  let stored;
  try {
    stored = await putMedia(workspaceId, dl.bytes, p.mime ?? dl.mime);
  } catch (err) {
    throw new PermanentJobError(`media_store_failed: ${(err as Error).message}`);
  }
  const sha = createHash('sha256').update(dl.bytes).digest('hex');
  await withWorkspaceTx(workspaceId, async (tx) => {
    const again = (
      await tx.execute<Loose>(
        sql`select media_id, kind, transcript_status from messages where id = ${p.messageId} for update`,
      )
    ).rows[0];
    if (!again || again.media_id) return;
    const ins = await tx.execute<{ id: string }>(sql`insert into media
      (workspace_id, blob_key, data, mime, filename, size_bytes, sha256, provider_media_id)
      values (${workspaceId}, ${'blobKey' in stored ? stored.blobKey : null}, ${'data' in stored ? stored.data : null},
              ${p.mime ?? dl.mime}, ${p.filename}, ${dl.bytes.byteLength}, ${sha}, ${p.providerMediaId}) returning id`);
    await tx.execute(sql`update messages set media_id = ${ins.rows[0]!.id} where id = ${p.messageId}`);
    // F8.1 (T-217): a voice note goes to the AI transcription job via the outbox (never awaited by the lead flow).
    if (again.kind === 'audio' && again.transcript_status === 'pending') {
      await enqueueJob(tx, {
        type: 'ai.transcribe',
        payload: { messageId: p.messageId },
        dedupeKey: `ai:transcribe:${p.messageId}:auto`,
        maxAttempts: 3,
      });
    }
    await emit(tx, { workspaceId, topic: 'messages', ids: [p.messageId] });
  });
}

export type MediaForServing = {
  mime: string;
  filename: string | null;
  size: number;
  data?: Buffer;
  blobKey?: string;
};

/** Authed proxy lookup (I1.6): permission + workspace (RLS) + conversation visibility, else 404. */
async function getMedia(actor: Actor, mediaId: string): Promise<MediaForServing> {
  assertPermission(actor, 'crm.contact.view');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const scope = await scopeSql(tx, actor, 'c');
    const r = (
      await tx.execute<Loose>(sql`select md.mime, md.filename, md.size_bytes, md.data, md.blob_key
        from media md join messages m on m.media_id = md.id join conversations c on c.id = m.conversation_id
        where md.id = ${mediaId} and ${scope} limit 1`)
    ).rows[0];
    if (!r) throw notFound();
    return {
      mime: r.mime,
      filename: r.filename,
      size: r.size_bytes,
      ...(r.data ? { data: Buffer.from(r.data) } : { blobKey: r.blob_key }),
    };
  });
}

export const messagingService = {
  listConversations,
  listMessages,
  listTemplates,
  markRead,
  send,
  retry,
  setOptOut,
  getMedia,
};
