// pnpm tsx --env-file=apps/web/.env.local scripts/ai-voice-real.ts
// REAL end-to-end voice-note check (T-217): OpenAI TTS makes a Roman-Urdu clip -> stored as an inbound WhatsApp
// audio message (media row + transcript_status='pending') -> outbox `ai.transcribe` -> runDueWork -> transcript +
// summary on the message. Needs OPENAI_API_KEY and the local DB. Never prints env/secrets.
process.env.AI_ENABLED = 'true';
process.env.INTEGRATIONS_FAKE = 'false';

const WS = '0192f3a0-0000-7000-8000-000000000001'; // Sunrise Solar (seed)
const SAY =
  process.argv[2] ??
  'Assalam o alaikum, mujhe 5 kilowatt solar system ka rate chahiye. Lahore mein DHA phase 5 mein ghar hai.';

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const { withWorkspaceTx } = await import('@relay/db');
  const { sql } = await import('drizzle-orm');
  const { runDueWork } = await import('../src/jobs/run-due-work');
  const { enqueueTranscription } = await import('../src/services/voice');

  // 1. TTS clip (mp3) — the transcription path is format-agnostic.
  const tts = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: SAY, response_format: 'mp3' }),
  });
  if (!tts.ok) throw new Error(`tts failed: ${tts.status}`);
  const audio = Buffer.from(await tts.arrayBuffer());
  console.log(`tts clip: ${audio.byteLength} bytes; said: "${SAY}"`);

  // 2. Store as an inbound audio message exactly like media.download would leave it.
  const wamid = `wamid.voice-real-${Date.now()}`;
  const messageId = await withWorkspaceTx(WS, async (tx) => {
    const conv = (
      await tx.execute<{
        id: string;
      }>(sql`insert into conversations (workspace_id, external_key, display_name)
        values (${WS}::uuid, '+923009990001', 'Voice Test')
        on conflict (workspace_id, channel, external_key) do update set display_name = excluded.display_name
        returning id`)
    ).rows[0]!;
    const media = (
      await tx.execute<{
        id: string;
      }>(sql`insert into media (workspace_id, data, mime, filename, size_bytes, sha256)
        values (${WS}::uuid, ${audio}, 'audio/mpeg', 'voice.mp3', ${audio.byteLength}, 'x') returning id`)
    ).rows[0]!;
    const m = (
      await tx.execute<{ id: string }>(sql`insert into messages
        (workspace_id, conversation_id, direction, author_type, kind, provider_message_id, status, media_id, transcript_status)
        values (${WS}::uuid, ${conv.id}::uuid, 'in', 'customer', 'audio', ${wamid}, 'delivered', ${media.id}::uuid, 'pending')
        returning id`)
    ).rows[0]!;
    await enqueueTranscription(tx, m.id, `real-${Date.now()}`);
    return m.id;
  });

  // 3. Run the outbox.
  const res = await runDueWork({ trigger: 'manual', scheduler: null, budgetMs: 60_000 });
  console.log('outbox processed:', res.outboxProcessed);

  // 4. Result.
  const row = await withWorkspaceTx(
    WS,
    async (tx) =>
      (
        await tx.execute<Record<string, unknown>>(
          sql`select transcript_status, transcript, summary, prompt_version, ai_meta from messages where id = ${messageId}::uuid`,
        )
      ).rows[0],
  );
  console.log(JSON.stringify(row, null, 2));
  const usage = await withWorkspaceTx(
    WS,
    async (tx) =>
      (
        await tx.execute<Record<string, unknown>>(
          sql`select task, model, status, cost_micros, latency_ms from ai_usage order by created_at desc limit 3`,
        )
      ).rows,
  );
  console.log('ai_usage:', JSON.stringify(usage));
  process.exit(row?.transcript_status === 'done' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
