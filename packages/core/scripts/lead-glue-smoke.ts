// Lead-engine glue smoke (Lane A2, dev only): inbound WhatsApp message → lead with owner + countdown →
// AI stand-in (real provider if configured) → owner Offline → immediate reassignment → recovery row.
// Usage: pnpm --filter @relay/core exec tsx scripts/lead-glue-smoke.ts   (reads apps/web/.env.local; never prints secrets)
import { existsSync } from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(import.meta.dirname, '../../../apps/web/.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { withSystemTx, withWorkspaceTx, closeDb } = await import('@relay/db');
const { sql } = await import('drizzle-orm');
await import('../src/services/register-hooks');
const { runInboundHandlers } = await import('../src/services/messaging-hooks');
const { runStandIn } = await import('../src/services/ai-standin');
const { setAvailability } = await import('../src/services/teams');
const { recoveryList } = await import('../src/services/lead-actions');
const { LEVEL_DEFAULTS } = await import('../src/auth/permissions');

const ws = (
  await withSystemTx((tx) =>
    tx.execute<{ id: string }>(sql`select messaging_resolve_workspace('none', 'sunrise') as id`),
  )
).rows[0]!.id;
const phone = `+92300${String(Date.now()).slice(-7)}`;
const out = await withWorkspaceTx(ws, async (tx) => {
  const conv = (
    await tx.execute<{
      id: string;
    }>(sql`insert into conversations (workspace_id, external_key, display_name, last_inbound_at)
      values (${ws}::uuid, ${phone}, 'Smoke Customer', now()) returning id`)
  ).rows[0]!.id;
  const msg = (
    await tx.execute<{
      id: string;
    }>(sql`insert into messages (workspace_id, conversation_id, direction, author_type, body, status)
      values (${ws}::uuid, ${conv}::uuid, 'in', 'customer', 'Salam, I need a quote for a 5 kW solar system for my house', 'delivered') returning id`)
  ).rows[0]!.id;
  const r = await runInboundHandlers(tx, {
    workspaceId: ws,
    contactId: null,
    phone,
    name: 'Smoke Customer',
    text: 'Salam, I need a quote for a 5 kW solar system for my house',
    conversationId: conv,
    messageId: msg,
    at: new Date(),
  });
  if (r.contactId)
    await tx.execute(
      sql`update conversations set contact_id = ${r.contactId}::uuid where id = ${conv}::uuid`,
    );
  const lead = (
    await tx.execute<
      Record<string, unknown>
    >(sql`select l.id, l.owner_user_id, u.name, l.custody, l.ack_window_ends_at, l.source_kind
      from leads l join users u on u.id = l.owner_user_id where l.contact_id = ${r.contactId}::uuid and l.status = 'open'`)
  ).rows[0]!;
  const job = (
    await tx.execute<Record<string, unknown>>(
      sql`select type, available_at from outbox where dedupe_key = ${`ai:standin:${msg}`}`,
    )
  ).rows[0];
  return { conv, msg, contactId: r.contactId, lead, job };
});
console.log('1. lead created:', JSON.stringify(out.lead), '\n   stand-in job:', JSON.stringify(out.job));

const ai = await runStandIn(ws, {
  leadId: out.lead.id as string,
  conversationId: out.conv,
  messageId: out.msg,
});
const aiMsg = await withWorkspaceTx(ws, (tx) =>
  tx.execute<Record<string, unknown>>(
    sql`select author_type, status, left(body, 160) body from messages where id = ${ai.messageId ?? null}::uuid`,
  ),
);
console.log('2. stand-in:', ai.outcome, ai.why ?? '', JSON.stringify(aiMsg.rows[0] ?? null));

const ownerId = out.lead.owner_user_id as string;
const actor = {
  userId: ownerId,
  workspaceId: ws,
  sessionId: '',
  baseLevel: 'owner' as const,
  permissions: new Set(LEVEL_DEFAULTS.owner),
  locale: 'en' as const,
};
const abs = await setAvailability(actor as never, ownerId, 'offline');
const after = await withWorkspaceTx(ws, (tx) =>
  tx.execute<Record<string, unknown>>(sql`select u.name, l.custody, l.awaiting_reason, l.escalation_count,
      (select string_agg(type, ',' order by occurred_at) from lead_events e where e.lead_id = l.id) events
    from leads l join users u on u.id = l.owner_user_id where l.id = ${out.lead.id as string}::uuid`),
);
console.log(
  '3. owner offline → reassigned:',
  JSON.stringify(abs.reassignedLeadIds),
  JSON.stringify(after.rows[0]),
);
await setAvailability(actor as never, ownerId, 'available');
const rq = await recoveryList(actor as never, {});
console.log(
  '4. recovery queue:',
  rq.total,
  'items; reasons of first 3:',
  JSON.stringify(rq.items.slice(0, 3).map((i) => [i.contactName, i.reasons, i.action])),
);
await closeDb();
