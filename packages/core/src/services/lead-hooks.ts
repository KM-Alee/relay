// Lead-engine hook implementations for other lanes' seams (registered once by ./register-hooks.ts).
// Owner: Lane A.
//  - WhatsApp inbound (Lane C) → T1 intake (new lead / returning customer after close, OQ-5) or attach
//    the message to the open lead; Contact 360 timeline; AI stand-in trigger (F6.2)
//  - CRM human actions (Lane B: note, call, stage change) → T10 auto-ack by the owner; won/lost → T11
//  - outbound human WhatsApp message (Lane C) → T10 'message_out' + AI handoff (F6.10)
//  - voice note transcribed (T-217) → urgency + stand-in like a text message (F8.2)
import { withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { systemActor } from '../audit/index';
import type { Actor } from '../auth/actor';
import type { HumanActionType } from '../domain/leads';
import { uuidv7 } from '../ids';
import { enqueueJob } from '../integrations/upstream';
import { applyTriageUrgency, scheduleStandIn } from './ai-standin';
import type { HumanActionInput } from './crm-activity';
import { closeOpenLeadForContactInTx } from './lead-actions';
import { intakeInTx, recordHumanActionInTx } from './leads';
import type {
  InboundCustomerMessage,
  InboundCustomerMessageResult,
  OutboundHumanMessage,
  TranscriptReady,
} from './messaging-hooks';

async function openLeadIdForContact(tx: Tx, contactId: string): Promise<string | null> {
  const r = await tx.execute<{ id: string }>(
    sql`select id from leads where contact_id = ${contactId}::uuid and status = 'open' limit 1`,
  );
  return r.rows[0]?.id ?? null;
}

async function whatsappSourceLabel(tx: Tx): Promise<{ id: string | null; label: string }> {
  const r = await tx.execute<{ id: string; label: string }>(
    sql`select id, label from lead_sources where kind = 'whatsapp' order by created_at limit 1`,
  );
  return r.rows[0] ? { id: r.rows[0].id, label: r.rows[0].label } : { id: null, label: 'WhatsApp' };
}

/** registerInboundCustomerMessageHandler: runs in the tx that stored the message (I1.5). */
export async function onInboundWhatsApp(
  tx: Tx,
  msg: InboundCustomerMessage,
): Promise<InboundCustomerMessageResult> {
  const src = await whatsappSourceLabel(tx);
  const out = await intakeInTx(tx, {
    workspaceId: msg.workspaceId,
    contact: { id: msg.contactId, name: msg.name?.trim() || msg.phone, phone: msg.phone },
    message: msg.text,
    source: { kind: 'whatsapp', id: src.id, label: src.label },
    actor: systemActor(msg.workspaceId),
  });
  if (out.created) {
    // Returning customer after a closed lead (OQ-5): a fresh lead → the AI may stand in again.
    await tx.execute(sql`update conversations set ai_state = 'off', assigned_user_id = ${out.ownerUserId}::uuid
      where id = ${msg.conversationId}::uuid and ai_state = 'handed_off'`);
  }
  if (out.contactId) {
    // Full history on the contact (F2.8): every customer message, attached to its lead.
    await tx.execute(sql`insert into activities (id, workspace_id, contact_id, lead_id, type, actor_type, payload, occurred_at)
      values (${uuidv7()}::uuid, ${msg.workspaceId}::uuid, ${out.contactId}::uuid, ${out.leadId}::uuid, 'message_in', 'system',
              ${JSON.stringify({ body: msg.text ?? '', conversationId: msg.conversationId, messageId: msg.messageId })}::jsonb,
              ${msg.at.toISOString()}::timestamptz)`);
    await tx.execute(sql`update contacts set last_activity_at = now() where id = ${out.contactId}::uuid`);
    await tx.execute(sql`update conversations set assigned_user_id = ${out.ownerUserId}::uuid
      where id = ${msg.conversationId}::uuid and assigned_user_id is distinct from ${out.ownerUserId}::uuid`);
  }
  // Text only here; a voice note continues after transcription (onTranscript).
  if (msg.text?.trim())
    await scheduleStandIn(tx, {
      workspaceId: msg.workspaceId,
      leadId: out.leadId,
      conversationId: msg.conversationId,
      messageId: msg.messageId,
    });
  return { contactId: out.contactId };
}

const ACTION_OF: Partial<Record<string, HumanActionType>> = {
  note: 'note',
  call: 'call',
  stage_change: 'stage_change',
  appointment: 'appointment',
  message_out: 'message_out',
};

/** registerHumanActionHandler (Lane B): owner action auto-acks (T10); won/lost stage closes (T11). */
export async function onCrmHumanAction(tx: Tx, input: HumanActionInput): Promise<void> {
  const action = input.type ? ACTION_OF[input.type] : undefined;
  if (!action) return; // field edits are not recorded human actions (requirements §9)
  const leadId = input.leadId ?? (await openLeadIdForContact(tx, input.contactId));
  if (!leadId) return;
  await recordHumanActionInTx(tx, input.actor, leadId, action);
  if (action === 'stage_change' && typeof input.payload?.toStageId === 'string') {
    const kind = (
      await tx.execute<{ kind: string }>(
        sql`select kind from stages where id = ${input.payload.toStageId}::uuid`,
      )
    ).rows[0]?.kind;
    if (kind === 'won' || kind === 'lost')
      await closeOpenLeadForContactInTx(tx, input.actor.workspaceId, input.contactId, kind, input.actor);
  }
}

/** registerOutboundHumanMessageHandler (Lane C): T10 'message_out' + end the AI stand-in (F6.10). */
export async function onOutboundHumanMessage(tx: Tx, msg: OutboundHumanMessage, actor: Actor): Promise<void> {
  if (!msg.contactId) return;
  const leadId = await openLeadIdForContact(tx, msg.contactId);
  const body = (
    await tx.execute<{ body: string | null }>(
      sql`select body from messages where id = ${msg.messageId}::uuid`,
    )
  ).rows[0]?.body;
  await tx.execute(sql`insert into activities (id, workspace_id, contact_id, lead_id, type, actor_type, actor_user_id, payload)
    values (${uuidv7()}::uuid, ${msg.workspaceId}::uuid, ${msg.contactId}::uuid, ${leadId}::uuid, 'message_out', 'user',
            ${actor.userId}::uuid, ${JSON.stringify({ body: body ?? '', conversationId: msg.conversationId, messageId: msg.messageId })}::jsonb)`);
  if (!leadId) return;
  await recordHumanActionInTx(tx, actor, leadId, 'message_out');
  const ai = (
    await tx.execute<{ ai_state: string }>(
      sql`select ai_state from conversations where id = ${msg.conversationId}::uuid`,
    )
  ).rows[0]?.ai_state;
  if (ai === 'active')
    await enqueueJob(tx, {
      type: 'ai.handoff',
      payload: { leadId, reason: 'human_message' },
      dedupeKey: `ai:handoff:${leadId}:msg:${msg.messageId}`,
      maxAttempts: 3,
    });
}

/** onTranscriptReady (T-217): a voice note feeds urgency + the stand-in like a text message (F8.2). */
export async function onTranscript(e: TranscriptReady): Promise<void> {
  if (!e.contactId) return;
  await withWorkspaceTx(e.workspaceId, async (tx) => {
    const leadId = await openLeadIdForContact(tx, e.contactId!);
    if (!leadId) return;
    await applyTriageUrgency(tx, e.workspaceId, leadId, {
      ...e.triage,
      summary: e.summary,
    } as Parameters<typeof applyTriageUrgency>[3]);
    await scheduleStandIn(tx, {
      workspaceId: e.workspaceId,
      leadId,
      conversationId: e.conversationId,
      messageId: e.messageId,
    });
  });
}
