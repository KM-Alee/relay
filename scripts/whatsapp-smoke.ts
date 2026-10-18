// REAL WhatsApp smoke test through the app's Meta adapter (not the fake):
//   pnpm tsx scripts/whatsapp-smoke.ts
// Sends the `hello_world` template and a plain text message to each number in WHATSAPP_TEST_RECIPIENTS
// (comma-separated, E.164). Needs META_ACCESS_TOKEN + META_PHONE_NUMBER_ID (loaded from the env files;
// values are never printed). A free-text message only delivers if the recipient messaged the number in the
// last 24 h; the template always can (test numbers: recipient must be on the allowed list).
import { existsSync } from 'node:fs';
import { createMetaAdapter, DEFAULT_GRAPH_VERSION } from '../packages/core/src/integrations/meta/adapter';
import type { ProviderError } from '../packages/core/src/integrations/types';

for (const f of ['apps/web/.env.local', '.env.secrets.local', '.env.local']) {
  if (existsSync(f)) process.loadEnvFile(f);
}
const e = process.env;
const recipients = (e.WHATSAPP_TEST_RECIPIENTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => (s.startsWith('+') ? s : `+${s.replace(/\D/g, '')}`));
if (!e.META_ACCESS_TOKEN || !e.META_PHONE_NUMBER_ID || !recipients.length) {
  console.log(
    JSON.stringify({
      ok: false,
      reason: 'META_ACCESS_TOKEN / META_PHONE_NUMBER_ID / WHATSAPP_TEST_RECIPIENTS missing',
    }),
  );
  process.exit(2);
}
const creds = {
  accessToken: e.META_ACCESS_TOKEN,
  phoneNumberId: e.META_PHONE_NUMBER_ID,
  graphVersion: e.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
};
const wa = createMetaAdapter();
const mask = (p: string) => `***${p.slice(-4)}`;
let failures = 0;

for (const to of recipients) {
  for (const [label, run] of [
    [
      'template hello_world',
      () => wa.sendTemplate(to, { name: 'hello_world', lang: 'en_US', params: [] }, creds),
    ],
    ['text', () => wa.sendText(to, 'Relay smoke test: hello from the WhatsApp adapter.', creds)],
  ] as const) {
    try {
      const r = await run();
      console.log(`OK   ${label} -> ${mask(to)} message id ${r.providerMessageId}`);
    } catch (err) {
      failures++;
      const pe = err as ProviderError;
      console.log(`FAIL ${label} -> ${mask(to)} kind=${pe.kind} reason=${pe.code} :: ${pe.message}`);
    }
  }
}
process.exit(failures ? 1 : 0);
