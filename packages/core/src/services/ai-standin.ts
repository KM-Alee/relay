// AI stand-in glue (F6.2, F6.3, F6.7, F6.10, F9.2; T-206/T-207). Owner: Lane A (lead-engine side).
//
//   inbound customer message (lead pending) ──► scheduleStandIn (in the intake tx: outbox row, available
//   after `trigger_unacked_seconds` through clock.deadline, or now when nobody is available)
//   ──► ai.standin_reply job: re-check → generateStandInReply (outside any tx) → messages(author_type='ai')
//       + whatsapp.send → brief for alerts (generateHandoffBrief, stored on the lead)
//   human takeover (owner ack / owner message / claim) ──► ai.handoff job: "X has joined" + brief
//
// HARD RULE (AGENTS.md rule 7): nothing in this file acknowledges, owns, transfers or touches lead timers.
// It never imports a lead transition (ai-standin.test.ts checks the imports). It only writes the AI
// display columns (ai_active / ai_started_at / ai_handoff_at / ai_brief) and append-only lead_events.
import { withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import {
  detectFromMessages,
  generateHandoffBrief,
  generateStandInReply,
  humanJoined,
  shouldMarkUrgent,
  triageMessage,
  type Lang,
  type Triage,
  type Turn,
} from '../ai/index';
import { clock } from '../clock';
import { uuidv7 } from '../ids';
import { enqueueJob } from '../integrations/upstream';
import { ensureWakeBy } from '../jobs/scheduler';
import { log } from '../log';
import { emit } from '../realtime/index';
import { aiDepsFor, loadKnowledge } from './ai-admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

export type StandInMode = 'off' | 'unacked' | 'no_handler' | 'after_hours';

/**
 * Workspace stand-in settings (ai_settings, T-208) read in the caller's tx. No row → the documented
 * default (03 §3): after 20 s unacknowledged, or at once when nobody is available.
 */
export async function standInSettings(
  tx: Tx,
  workspaceId: string,
): Promise<{ mode: StandInMode; waitSeconds: number; aiEnabled: boolean; triageEnabled: boolean }> {
  const r = (
    await tx.execute<Loose>(
      sql`select standin_mode, trigger_unacked_seconds, ai_enabled, triage_enabled from ai_settings
          where workspace_id = ${workspaceId}::uuid`,
    )
  ).rows[0];
  if (!r) return { mode: 'unacked', waitSeconds: 20, aiEnabled: true, triageEnabled: true };
  return {
    mode: r.standin_mode as StandInMode,
    waitSeconds: Number(r.trigger_unacked_seconds),
    aiEnabled: !!r.ai_enabled,
    triageEnabled: !!r.triage_enabled,
  };
}

/** Pure trigger decision (F6.2). `null` = no stand-in for this message. */
export function standInDelaySeconds(
  s: { mode: StandInMode; waitSeconds: number; aiEnabled: boolean },
  lead: { custody: 'handler' | 'fallback'; ackStatus: 'pending' | 'acknowledged' },
  localHour: number,
): number | null {
  if (!s.aiEnabled || s.mode === 'off' || lead.ackStatus !== 'pending') return null;
  const nobody = lead.custody === 'fallback';
  if (s.mode === 'no_handler') return nobody ? 0 : null;
  if (s.mode === 'after_hours') return localHour < 9 || localHour >= 18 ? 0 : null;
  return nobody ? 0 : Math.max(0, s.waitSeconds); // 'unacked': after N s, or now if nobody available
}

/** In the inbound-message tx: queue `ai.standin_reply` for this customer message when the trigger applies. */
export async function scheduleStandIn(
  tx: Tx,
  p: { workspaceId: string; leadId: string; conversationId: string; messageId: string },
): Promise<Date | null> {
  const lead = (
    await tx.execute<Loose>(
      sql`select l.custody, l.ack_status, l.status, w.time_warp_multiplier,
                 extract(hour from now() at time zone w.timezone)::int as hour
            from leads l join workspaces w on w.id = l.workspace_id where l.id = ${p.leadId}::uuid`,
    )
  ).rows[0];
  if (!lead || lead.status !== 'open') return null;
  const s = await standInSettings(tx, p.workspaceId);
  const delay = standInDelaySeconds(
    s,
    { custody: lead.custody, ackStatus: lead.ack_status },
    Number(lead.hour),
  );
  if (delay === null) return null;
  const now = new Date((await tx.execute<{ n: string }>(sql`select statement_timestamp() n`)).rows[0]!.n);
  const at = clock.deadline({ timeWarpMultiplier: lead.time_warp_multiplier }, delay, now);
  await enqueueJob(tx, {
    type: 'ai.standin_reply',
    payload: { leadId: p.leadId, conversationId: p.conversationId, messageId: p.messageId },
    dedupeKey: `ai:standin:${p.messageId}`,
    availableAt: at,
    maxAttempts: 3,
  });
  await ensureWakeBy(tx, at);
  return at;
}

function turnsOf(rows: Loose[]): Turn[] {
  const out: Turn[] = [];
  for (const m of rows) {
    const text = (m.body ?? m.transcript ?? '') as string;
    if (!text.trim()) continue;
    if (m.author_type === 'customer') out.push({ role: 'customer', text });
    else if (m.author_type === 'ai') out.push({ role: 'ai', text });
    else if (m.author_type === 'user') out.push({ role: 'human', text });
  }
  return out;
}

async function historyOf(tx: Tx, conversationId: string, limit: number): Promise<Turn[]> {
  const rows = (
    await tx.execute<Loose>(sql`select author_type, body, transcript from messages
      where conversation_id = ${conversationId}::uuid order by created_at desc, id desc limit ${limit}`)
  ).rows.reverse();
  return turnsOf(rows);
}

/** Store the latest brief on the lead (display data; read by the lead page + Slack alerts). */
async function storeBrief(workspaceId: string, leadId: string, brief: Loose): Promise<void> {
  await withWorkspaceTx(workspaceId, async (tx) => {
    await tx.execute(sql`update leads set ai_brief = ${JSON.stringify(brief)}::jsonb, ai_brief_at = now()
      where id = ${leadId}::uuid`);
    await emit(tx, { workspaceId, topic: 'leads', ids: [leadId] });
  });
}

/** Mark the lead urgent from AI triage (F6.6). Attribute only: no owner, ack or timer change. */
export async function applyTriageUrgency(tx: Tx, workspaceId: string, leadId: string, t: Triage) {
  if (!shouldMarkUrgent(t)) return false;
  const r = await tx.execute<{ id: string }>(sql`update leads set is_urgent = true, urgent_source = 'ai'
    where id = ${leadId}::uuid and status = 'open' and not is_urgent returning id`);
  if (!r.rows.length) return false;
  await tx.execute(sql`insert into lead_events (id, workspace_id, lead_id, type, actor_type, meta, occurred_at)
    values (${uuidv7()}::uuid, ${workspaceId}::uuid, ${leadId}::uuid, 'urgent_set', 'ai',
            ${JSON.stringify({ urgency: t.urgency, sentiment: t.sentiment })}::jsonb, now())`);
  await emit(tx, { workspaceId, topic: 'leads', ids: [leadId] });
  return true;
}

// ── ai.standin_reply ────────────────────────────────────────────────────

export type StandInOutcome = 'sent' | 'skipped';

export async function runStandIn(
  workspaceId: string,
  p: { leadId: string; conversationId: string; messageId: string },
): Promise<{ outcome: StandInOutcome; why?: string; messageId?: string }> {
  // 1. Read + gate (short tx; the model call happens outside any transaction, rule 3).
  const pre = await withWorkspaceTx(workspaceId, async (tx) => {
    const s = await standInSettings(tx, workspaceId);
    if (!s.aiEnabled || s.mode === 'off') return { skip: 'disabled' as const };
    const lead = (
      await tx.execute<Loose>(sql`select l.*, u.name owner_name, w.name ws_name from leads l
        join users u on u.id = l.owner_user_id join workspaces w on w.id = l.workspace_id
        where l.id = ${p.leadId}::uuid`)
    ).rows[0];
    if (!lead || lead.status !== 'open' || lead.ack_status !== 'pending') return { skip: 'lead_not_pending' };
    const conv = (
      await tx.execute<Loose>(sql`select * from conversations where id = ${p.conversationId}::uuid`)
    ).rows[0];
    if (!conv || conv.opted_out) return { skip: 'opted_out' };
    if (conv.ai_state === 'handed_off') return { skip: 'handed_off' };
    const trigger = (
      await tx.execute<Loose>(sql`select created_at from messages where id = ${p.messageId}::uuid`)
    ).rows[0];
    if (!trigger) return { skip: 'no_message' };
    // Only answer the latest customer message, once, and never after a human spoke.
    const after = (
      await tx.execute<Loose>(sql`select author_type from messages where conversation_id = ${p.conversationId}::uuid
        and created_at > ${new Date(trigger.created_at).toISOString()}::timestamptz and id <> ${p.messageId}::uuid`)
    ).rows.map((r) => r.author_type as string);
    if (after.includes('customer')) return { skip: 'newer_message' };
    if (after.includes('user')) return { skip: 'human_replied' };
    if (after.includes('ai')) return { skip: 'already_answered' };
    const priorAi = (
      await tx.execute<{ n: number }>(sql`select count(*)::int n from messages
        where conversation_id = ${p.conversationId}::uuid and author_type = 'ai' and created_at >= ${new Date(lead.created_at).toISOString()}::timestamptz`)
    ).rows[0]!.n;
    const contact = lead.contact_id
      ? (
          await tx.execute<Loose>(
            sql`select name, language from contacts where id = ${lead.contact_id}::uuid`,
          )
        ).rows[0]
      : null;
    return {
      skip: null,
      s,
      lead,
      conv,
      contact,
      isFirst: Number(priorAi) === 0,
      history: await historyOf(tx, p.conversationId, 10),
    };
  });
  if (pre.skip !== null) return { outcome: 'skipped', why: pre.skip };
  const { lead, conv, contact, s, history } = pre;
  if (!history.some((t) => t.role === 'customer')) return { outcome: 'skipped', why: 'no_text' };

  // 2. AI calls (outside any tx). generateStandInReply never throws and only returns guarded text.
  const deps = await aiDepsFor(workspaceId);
  const triage = s.triageEnabled ? await triageMessage({ workspaceId, messages: history, deps }) : undefined;
  const knowledge = await loadKnowledge(workspaceId);
  const ownerFirstName =
    lead.custody === 'handler' ? String(lead.owner_name ?? '').split(/\s+/)[0] || null : null;
  const lang = (contact?.language as Lang | null) ?? conv.language ?? undefined;
  const reply = await generateStandInReply({
    workspaceId,
    workspaceName: lead.ws_name,
    language: lang ?? undefined,
    isFirstAiMessage: pre.isFirst,
    status: { ownerFirstName, notified: true },
    knowledge,
    contact: { name: contact?.name ?? lead.contact_name },
    collectedFields: {},
    openQuestions: [],
    history,
    triage,
    deps,
  });

  // 3. Store + queue the send; re-check: a human may have taken over during the model call.
  const sent = await withWorkspaceTx(workspaceId, async (tx) => {
    const again = (
      await tx.execute<Loose>(sql`select l.status, l.ack_status, c.ai_state, c.opted_out from leads l, conversations c
        where l.id = ${p.leadId}::uuid and c.id = ${p.conversationId}::uuid for update of c`)
    ).rows[0];
    if (!again || again.status !== 'open' || again.ack_status !== 'pending' || again.opted_out) return null;
    if (again.ai_state === 'handed_off') return null;
    const ins = await tx.execute<{ id: string }>(sql`insert into messages
      (workspace_id, conversation_id, direction, author_type, kind, body, status, status_at, prompt_version, ai_meta)
      values (${workspaceId}::uuid, ${p.conversationId}::uuid, 'out', 'ai', 'text', ${reply.text}, 'queued', now(),
              ${reply.promptVersion ?? null},
              ${JSON.stringify({
                task: 'standin_reply',
                kind: reply.kind,
                language: reply.language,
                handoff: reply.handoff,
                guards: reply.guards,
                fallbackReason: reply.fallbackReason ?? null,
                model: reply.model ?? null,
                costMicros: reply.costMicros ?? null,
                answeredFromKb: reply.answeredFromKb,
              })}::jsonb)
      returning id`);
    const id = ins.rows[0]!.id;
    await tx.execute(sql`update conversations set ai_state = 'active', last_message_at = now(),
      last_message_preview = ${reply.text.slice(0, 140)}, language = coalesce(language, ${reply.language}),
      version = version + 1 where id = ${p.conversationId}::uuid`);
    const first = await tx.execute<{ id: string }>(sql`update leads set ai_active = true,
      ai_started_at = coalesce(ai_started_at, now()) where id = ${p.leadId}::uuid and not ai_active returning id`);
    if (first.rows.length)
      await tx.execute(sql`insert into lead_events (id, workspace_id, lead_id, type, actor_type, meta, occurred_at)
        values (${uuidv7()}::uuid, ${workspaceId}::uuid, ${p.leadId}::uuid, 'ai_started', 'ai',
                ${JSON.stringify({ messageId: id })}::jsonb, now())`);
    if (lead.contact_id)
      await tx.execute(sql`insert into activities (id, workspace_id, contact_id, lead_id, type, actor_type, payload)
        values (${uuidv7()}::uuid, ${workspaceId}::uuid, ${lead.contact_id}::uuid, ${p.leadId}::uuid, 'ai_message', 'ai',
                ${JSON.stringify({ body: reply.text, conversationId: p.conversationId, messageId: id })}::jsonb)`);
    if (triage) await applyTriageUrgency(tx, workspaceId, p.leadId, triage);
    await enqueueJob(tx, {
      type: 'whatsapp.send',
      payload: { messageId: id },
      dedupeKey: `wa:send:${id}:0`,
      maxAttempts: 6,
    });
    await emit(tx, { workspaceId, topic: 'messages', ids: [id] });
    await emit(tx, { workspaceId, topic: 'conversations', ids: [p.conversationId] });
    await emit(tx, { workspaceId, topic: 'leads', ids: [p.leadId] });
    return id;
  });
  if (!sent) return { outcome: 'skipped', why: 'taken_over' };

  // 4. Brief for alerts (F9.2): computed now so an escalation alert can attach it without waiting.
  try {
    const brief = await generateHandoffBrief({
      workspaceId,
      fields: {},
      history: [...history, { role: 'ai', text: reply.text }],
      triage: triage
        ? {
            intent: triage.intent,
            sentiment: triage.sentiment,
            urgency: triage.urgency,
            summary: triage.summary,
          }
        : undefined,
      deps,
    });
    await storeBrief(workspaceId, p.leadId, brief);
  } catch (err) {
    log.warn('ai.standin_brief_failed', { leadId: p.leadId, err });
  }
  return { outcome: 'sent', messageId: sent };
}

// ── ai.handoff (human takeover, F6.10) ──────────────────────────────────

export async function runHandoff(
  workspaceId: string,
  p: { leadId: string; reason: string },
): Promise<{ outcome: 'handed_off' | 'skipped'; messageId?: string }> {
  const pre = await withWorkspaceTx(workspaceId, async (tx) => {
    const lead = (
      await tx.execute<Loose>(sql`select l.*, u.name owner_name from leads l join users u on u.id = l.owner_user_id
        where l.id = ${p.leadId}::uuid`)
    ).rows[0];
    if (!lead?.contact_id) return null;
    const conv = (
      await tx.execute<Loose>(sql`select * from conversations where contact_id = ${lead.contact_id}::uuid
        order by last_message_at desc nulls last limit 1 for update`)
    ).rows[0];
    if (!conv || conv.ai_state !== 'active') return null; // AI never spoke (or already handed off)
    const history = await historyOf(tx, conv.id, 15);
    const lang: Lang =
      (conv.language as Lang | null) ??
      detectFromMessages(history.filter((t) => t.role === 'customer').map((t) => t.text));
    const name = String(lead.owner_name ?? '').split(/\s+/)[0] ?? '';
    let messageId: string | null = null;
    if (!conv.opted_out) {
      const ins = await tx.execute<{ id: string }>(sql`insert into messages
        (workspace_id, conversation_id, direction, author_type, kind, body, status, status_at)
        values (${workspaceId}::uuid, ${conv.id}::uuid, 'out', 'system', 'text', ${humanJoined(lang, name)}, 'queued', now())
        returning id`);
      messageId = ins.rows[0]!.id;
      await enqueueJob(tx, {
        type: 'whatsapp.send',
        payload: { messageId },
        dedupeKey: `wa:send:${messageId}:0`,
        maxAttempts: 6,
      });
      await emit(tx, { workspaceId, topic: 'messages', ids: [messageId] });
    }
    await tx.execute(
      sql`update conversations set ai_state = 'handed_off', version = version + 1 where id = ${conv.id}::uuid`,
    );
    await tx.execute(
      sql`update leads set ai_active = false, ai_handoff_at = now() where id = ${p.leadId}::uuid`,
    );
    await tx.execute(sql`insert into lead_events (id, workspace_id, lead_id, type, actor_type, meta, occurred_at)
      values (${uuidv7()}::uuid, ${workspaceId}::uuid, ${p.leadId}::uuid, 'ai_handoff', 'system',
              ${JSON.stringify({ reason: p.reason, joinedMessageId: messageId })}::jsonb, now())`);
    await emit(tx, { workspaceId, topic: 'conversations', ids: [conv.id] });
    await emit(tx, { workspaceId, topic: 'leads', ids: [p.leadId] });
    return { history, lang, messageId };
  });
  if (!pre) return { outcome: 'skipped' };
  try {
    const brief = await generateHandoffBrief({
      workspaceId,
      fields: {},
      history: pre.history,
      language: pre.lang,
      deps: await aiDepsFor(workspaceId),
    });
    await storeBrief(workspaceId, p.leadId, brief);
  } catch (err) {
    log.warn('ai.handoff_brief_failed', { leadId: p.leadId, err });
  }
  return { outcome: 'handed_off', messageId: pre.messageId ?? undefined };
}
