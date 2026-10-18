// Voice notes (T-217; F8.1-F8.3). `media.download` links the audio -> `ai.transcribe` (outbox, so the lead
// flow never waits) -> transcript + one-line summary stored on the message, labelled "AI transcript" in the UI.
// Failure/disabled => transcript_status='failed' (audio stays playable) + Retry (POST /ai/transcribe/:id).
import { withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { detect } from '../ai/lang';
import { triageMessage } from '../ai/tasks/triage';
import { TRANSCRIBE_PROMPT_VERSION, transcribeAudio } from '../ai/tasks/transcribe';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { notFound } from '../errors';
import { getMediaStream } from '../integrations/blob';
import { enqueueJob } from '../integrations/upstream';
import { log } from '../log';
import { emit } from '../realtime';
import { aiDepsFor, getAiSettings } from './ai-admin';
import { scopeSql } from './messaging';
import { runTranscriptHandlers } from './messaging-hooks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

/** Enqueue `ai.transcribe` inside the caller's tx (idempotent per message + attempt tag). */
export async function enqueueTranscription(tx: Tx, messageId: string, tag = 'auto'): Promise<void> {
  await enqueueJob(tx, {
    type: 'ai.transcribe',
    payload: { messageId },
    dedupeKey: `ai:transcribe:${messageId}:${tag}`,
    maxAttempts: 3,
  });
}

async function readAudio(row: Loose): Promise<Uint8Array | null> {
  if (row.data) return new Uint8Array(row.data as Buffer);
  if (row.blob_key) {
    const stream = await getMediaStream(row.blob_key);
    if (!stream) return null;
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return null;
}

async function fail(workspaceId: string, messageId: string, reason: string) {
  await withWorkspaceTx(workspaceId, async (tx) => {
    await tx.execute(sql`update messages set transcript_status = 'failed',
      ai_meta = coalesce(ai_meta, '{}'::jsonb) || ${JSON.stringify({ task: 'transcription', error: reason })}::jsonb
      where id = ${messageId}::uuid and transcript_status <> 'done'`);
    await emit(tx, { workspaceId, topic: 'messages', ids: [messageId] });
  });
}

/** Job body. Provider failures never throw: they become the visible failed state + Retry (F8.3). */
export async function transcribeMessage(workspaceId: string, messageId: string): Promise<void> {
  const row = await withWorkspaceTx(workspaceId, async (tx) => {
    const r = (
      await tx.execute<Loose>(sql`select m.id, m.conversation_id, m.transcript_status, c.contact_id,
          md.data, md.blob_key, md.mime
        from messages m join conversations c on c.id = m.conversation_id
        left join media md on md.id = m.media_id where m.id = ${messageId}::uuid`)
    ).rows[0];
    return r ?? null;
  });
  if (!row || row.transcript_status === 'done') return;
  if (!row.mime) return fail(workspaceId, messageId, 'no_media');

  const settings = await getAiSettings(workspaceId);
  if (!settings.transcribeEnabled) return fail(workspaceId, messageId, 'disabled');
  const audio = await readAudio(row);
  if (!audio) return fail(workspaceId, messageId, 'no_media');

  const deps = await aiDepsFor(workspaceId);
  const res = await transcribeAudio({ workspaceId, audio, mime: row.mime, deps });
  if (!res.ok) return fail(workspaceId, messageId, res.error);
  const transcript = res.value.trim().slice(0, 4000);
  if (!transcript) return fail(workspaceId, messageId, 'empty');

  // One-line summary + triage of the transcript (one cheap call; heuristic when AI is off/over budget).
  const tri = await triageMessage({
    workspaceId,
    messages: [{ role: 'customer', text: transcript }],
    deps: { ...deps, enabled: deps.enabled && settings.triageEnabled },
  });
  const summary = (tri.summary || transcript).replace(/\s+/g, ' ').slice(0, 140);

  await withWorkspaceTx(workspaceId, async (tx) => {
    await tx.execute(sql`update messages set transcript = ${transcript}, transcript_status = 'done',
      summary = ${summary}, prompt_version = ${TRANSCRIBE_PROMPT_VERSION},
      ai_meta = ${JSON.stringify({
        task: 'transcription',
        model: res.model,
        latencyMs: res.latencyMs,
        costMicros: res.usage.costMicros,
        triage: { source: tri.source, promptVersion: tri.promptVersion ?? null },
      })}::jsonb
      where id = ${messageId}::uuid`);
    await tx.execute(sql`update conversations set last_message_preview = ${('Voice: ' + summary).slice(0, 140)}
      where id = ${row.conversation_id}::uuid and last_message_preview = '[audio]'`);
    await emit(tx, { workspaceId, topic: 'messages', ids: [messageId] });
    await emit(tx, { workspaceId, topic: 'conversations', ids: [row.conversation_id] });
  });

  // F8.2: the transcript continues down the same path as a text message (outside the tx).
  await runTranscriptHandlers({
    workspaceId,
    conversationId: row.conversation_id,
    messageId,
    contactId: row.contact_id ?? null,
    transcript,
    summary,
    triage: {
      language: tri.language ?? detect(transcript),
      urgency: tri.urgency,
      sentiment: tri.sentiment,
      wantsHuman: tri.wantsHuman,
      intent: tri.intent,
    },
  }).catch((e) => log.warn('transcript handlers failed', { err: e }));
}

/** F8.3: Retry. Permission + conversation visibility (404 otherwise); a finished transcript is left alone. */
export async function retryTranscription(actor: Actor, messageId: string): Promise<{ ok: true }> {
  assertPermission(actor, 'crm.contact.view');
  await withWorkspaceTx(actor.workspaceId, async (tx) => {
    const scope = await scopeSql(tx, actor, 'c');
    const r = (
      await tx.execute<Loose>(sql`select m.id, m.transcript_status from messages m
        join conversations c on c.id = m.conversation_id
        where m.id = ${messageId}::uuid and m.kind = 'audio' and ${scope}`)
    ).rows[0];
    if (!r) throw notFound();
    if (r.transcript_status === 'done') return;
    await tx.execute(sql`update messages set transcript_status = 'pending' where id = ${messageId}::uuid`);
    await enqueueTranscription(tx, messageId, `retry-${Date.now()}`);
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'messages', ids: [messageId] });
  });
  return { ok: true };
}
