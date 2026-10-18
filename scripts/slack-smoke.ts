// Manual smoke test against the REAL Slack workspace through the app's adapter (not the fake):
//   pnpm tsx scripts/slack-smoke.ts            -> auth.test, DM the first human member a sample alert, chat.update it
// Needs SLACK_BOT_TOKEN in the environment (loaded from the env files by this script; values are never printed).
import { existsSync } from 'node:fs';
import { createSlackAdapter } from '../packages/core/src/integrations/slack/adapter';
import { buildAlert, buildResolved } from '../packages/core/src/integrations/slack/blocks';

for (const f of ['apps/web/.env.local', '.env.secrets.local', '.env.local']) {
  if (existsSync(f)) process.loadEnvFile(f);
}
const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  console.log(JSON.stringify({ ok: false, reason: 'SLACK_BOT_TOKEN not available in this environment' }));
  process.exit(2);
}
const creds = { botToken: token };
const slack = createSlackAdapter();

async function api(method: string, params: Record<string, unknown> = {}) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  return (await r.json()) as { ok: boolean; error?: string; members?: Array<Record<string, any>> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const auth = await slack.authTest(creds);
console.log('auth.test ok', { teamId: auth.teamId, botUserId: auth.botUserId });

const list = await api('users.list', { limit: 200 });
if (!list.ok) {
  console.log('users.list failed:', list.error);
  process.exit(1);
}
const human = list.members?.find((m) => !m.is_bot && !m.deleted && m.id !== 'USLACKBOT' && !m.is_app_user);
if (!human) {
  console.log('no human member found');
  process.exit(1);
}
console.log('target member id', human.id);

const msg = buildAlert(
  {
    leadId: '00000000-0000-7000-8000-000000000001',
    leadName: 'Sample Lead (Relay smoke test)',
    source: 'Website form',
    purpose: 'escalated',
    reason: 'This is a test alert from Relay setup: please ignore.',
    level: 1,
    deadlineAt: new Date(Date.now() + 5 * 60_000),
    valueText: null,
    baseUrl: process.env.PUBLIC_BASE_URL ?? 'https://relay.example.com',
    locale: 'en',
    alertId: 'smoketest01',
  },
  process.env.SESSION_SECRET ?? 'smoke',
  new Date(),
);
const sent = await slack.sendAlert(human.id, msg, creds);
console.log('chat.postMessage ok', sent);
await slack.updateAlert(
  sent.channel,
  sent.ts,
  buildResolved('Relay smoke test: alert updated via chat.update. Nothing to do.'),
  creds,
);
console.log('chat.update ok', sent.ts);
