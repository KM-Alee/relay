// End-to-end check of the LOCAL WhatsApp webhook with the real META_APP_SECRET (never printed):
//   pnpm dev:web   (other terminal)   then   pnpm tsx scripts/whatsapp-webhook-check.ts [baseUrl]
// Sends (1) a correctly signed inbound text twice and (2) a forged one to /api/webhooks/meta/default, then
// reads the DB as app_user: expects 1 stored message, duplicate_count 1, and a rejected forgery row.
import { existsSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';

for (const f of ['apps/web/.env.local', '.env.secrets.local', '.env.local']) {
  if (existsSync(f)) process.loadEnvFile(f);
}
const secret = process.env.META_APP_SECRET;
if (!secret) {
  console.log('META_APP_SECRET missing');
  process.exit(2);
}
const { closeDb, withSystemTx, withWorkspaceTx } = await import('../packages/db/src');
const { sql } = await import('../packages/core/node_modules/drizzle-orm/index.js');
const base = process.argv[2] ?? `http://localhost:${process.env.PORT ?? 3141}`;
const url = `${base}/api/webhooks/meta/default`;
const sign = (body: string, s = secret) => 'sha256=' + createHmac('sha256', s).update(body).digest('hex');
const wamid = `wamid.CHECK${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const phone = '923000000001';
const payload = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '15550000000',
              phone_number_id: process.env.META_PHONE_NUMBER_ID ?? 'x',
            },
            contacts: [{ profile: { name: 'Webhook Check' }, wa_id: phone }],
            messages: [
              {
                from: phone,
                id: wamid,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body: 'webhook check hello' },
              },
            ],
          },
        },
      ],
    },
  ],
});
const post = async (body: string, sig: string) =>
  (
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })
  ).status;

const forged = await post(payload, sign(payload, 'not-the-secret'));
const first = await post(payload, sign(payload));
const second = await post(payload, sign(payload));
console.log({ forgedStatus: forged, firstStatus: first, duplicateStatus: second });
await new Promise((r) => setTimeout(r, 2500)); // after() processing

const ws = await withSystemTx(
  async (tx) =>
    (
      await tx.execute<{ w: string | null }>(
        sql`select messaging_resolve_workspace(${process.env.META_PHONE_NUMBER_ID ?? null}, ${process.env.WHATSAPP_DEFAULT_WORKSPACE_SLUG ?? null}) w`,
      )
    ).rows[0]?.w,
);
if (!ws) {
  console.log('no default workspace resolved');
  process.exit(1);
}
const out = await withWorkspaceTx(ws, async (tx) => ({
  messages: (await tx.execute(sql`select count(*)::int n from messages where provider_message_id = ${wamid}`))
    .rows[0],
  event: (
    await tx.execute(
      sql`select status, duplicate_count from integration_events where external_event_id = ${wamid}`,
    )
  ).rows[0],
  rejected: (
    await tx.execute(
      sql`select count(*)::int n from integration_events where provider = 'meta_whatsapp' and status = 'rejected'`,
    )
  ).rows[0],
}));
console.log(out);
await closeDb();
const ok = forged === 401 && first === 200 && second === 200 && (out.messages as { n: number }).n === 1;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
