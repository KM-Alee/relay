// Manual end-to-end check of the Slack Acknowledge button (T-203, I4.5) against the REAL Slack workspace:
//   1. link a local seed user to a real Slack member (SLACK_E2E_USER, default the first human member)
//   2. post a real alert (with the Acknowledge button) for a pending lead that user owns
//   3. POST a correctly signed block_actions payload to the local /api/webhooks/slack/default/interactions
//   4. verify: lead acknowledged via slack, alert row acknowledged, chat.update delivered (outbound event ok)
// Needs the dev server running (APP_URL, default http://localhost:3000) and a seeded local DB.
// Env is loaded from the env files by this script; values are never printed.
//   pnpm tsx scripts/slack-ack-e2e.ts
import { existsSync } from 'node:fs';

for (const f of ['apps/web/.env.local', '.env.secrets.local', '.env.local']) {
  if (existsSync(f)) process.loadEnvFile(f);
}
const { withSystemTx, withWorkspaceTx } = await import('../packages/db/src/index');
const teamsRepo = await import('../packages/core/src/repos/teams');
const { sql } = await import('../packages/core/node_modules/drizzle-orm');
const { slackSignature } = await import('../packages/core/src/integrations/slack/signature');
const { createSlackAdapter } = await import('../packages/core/src/integrations/slack/adapter');
const { enqueueSlackAlert, sendSlackAlert } = await import('../packages/core/src/services/slack');

const token = process.env.SLACK_BOT_TOKEN;
const secret = process.env.SLACK_SIGNING_SECRET;
if (!token || !secret) {
  console.log(JSON.stringify({ ok: false, reason: 'SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET not available' }));
  process.exit(2);
}
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const SLACK_USER = process.env.SLACK_E2E_USER ?? 'U0CA2E3K84E';
const team = (await createSlackAdapter().authTest({ botToken: token })).teamId;

// A fresh pending lead through the real public form, then find it (the owner is whoever routing picked).
const leadName = `Ack E2E ${Date.now()}`;
const form = await fetch(`${APP}/api/public/forms/sunrise-solar`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: leadName,
    phone: `+9230${String(Date.now()).slice(-8)}`,
    message: 'T-203 end-to-end',
  }),
});
console.log('public form ->', form.status);
const found = await withSystemTx((tx) => teamsRepo.lookupWebForm(tx, 'sunrise-solar'));
if (!found) throw new Error('form sunrise-solar not found (run pnpm db:seed)');
const pick = await withWorkspaceTx(
  found.workspaceId,
  async (tx) =>
    (
      await tx.execute<{
        id: string;
        workspace_id: string;
        owner_user_id: string;
        version: number;
        contact_name: string;
      }>(
        sql`select id, workspace_id, owner_user_id, version, contact_name from leads where contact_name = ${leadName}`,
      )
    ).rows[0],
);
if (!pick) {
  console.log(JSON.stringify({ ok: false, reason: 'lead not created by the form' }));
  process.exit(1);
}
const ws = pick.workspace_id;

await withWorkspaceTx(ws, async (tx) => {
  await tx.execute(
    sql`update users set slack_user_id = null, slack_team_id = null where slack_user_id = ${SLACK_USER}`,
  );
  await tx.execute(
    sql`update users set slack_user_id = ${SLACK_USER}, slack_team_id = ${team} where id = ${pick.owner_user_id}`,
  );
});

// 2. Real alert (DM) with the Acknowledge button.
const alertId = await withWorkspaceTx(ws, (tx) =>
  enqueueSlackAlert(tx, {
    workspaceId: ws,
    userId: pick.owner_user_id,
    leadId: pick.id,
    leadVersion: pick.version + (Date.now() % 100000), // unique dedupe key per run
    purpose: 'escalated',
    leadName: pick.contact_name,
    source: 'Website form',
    reason: 'T-203 end-to-end check: press Acknowledge',
    level: 1,
    deadlineAt: new Date(Date.now() + 5 * 60_000),
  }),
);
if (!alertId) throw new Error('alert deduped');
const payload = {
  alertId,
  leadId: pick.id,
  userId: pick.owner_user_id,
  purpose: 'escalated' as const,
  leadVersion: pick.version,
  leadName: pick.contact_name,
  source: 'Website form',
  reason: 'T-203 end-to-end check: press Acknowledge',
  level: 1,
  deadlineAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  valueText: null,
};
await sendSlackAlert(ws, payload);
const alert = await withWorkspaceTx(
  ws,
  async (tx) =>
    (
      await tx.execute<{ status: string; slack_channel: string; slack_ts: string }>(
        sql`select status, slack_channel, slack_ts from slack_alerts where id = ${alertId}`,
      )
    ).rows[0],
);
console.log('alert posted', { status: alert?.status, hasTs: !!alert?.slack_ts });

// 3. Signed block_actions payload, exactly as Slack sends it (form-encoded `payload`).
const { signAlertId } = await import('../packages/core/src/integrations/slack/blocks');
const value = signAlertId(alertId, process.env.SESSION_SECRET!);
const body = new URLSearchParams({
  payload: JSON.stringify({
    type: 'block_actions',
    user: { id: SLACK_USER, team_id: team },
    team: { id: team },
    trigger_id: `e2e.${Date.now()}`,
    response_url: 'https://hooks.slack.com/actions/T000/B000/e2e',
    channel: { id: alert!.slack_channel },
    message: { ts: alert!.slack_ts },
    actions: [{ action_id: 'lead_ack', value, action_ts: String(Date.now() / 1000) }],
  }),
}).toString();
const ts = String(Math.floor(Date.now() / 1000));
const res = await fetch(`${APP}/api/webhooks/slack/default/interactions`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    'x-slack-request-timestamp': ts,
    'x-slack-signature': slackSignature(secret, ts, body),
  },
  body,
});
console.log('interaction POST ->', res.status);

// 4. Verify (poll: processing runs in after(), the chat.update in the outbox).
let lead: any, al: any, out: any; // eslint-disable-line @typescript-eslint/no-explicit-any
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  [lead, al, out] = await withWorkspaceTx(ws, async (tx) => [
    (
      await tx.execute<{ ack_status: string; acknowledged_via: string | null }>(
        sql`select ack_status, acknowledged_via from leads where id = ${pick.id}`,
      )
    ).rows[0],
    (await tx.execute<{ status: string }>(sql`select status from slack_alerts where id = ${alertId}`))
      .rows[0],
    (
      await tx.execute<{ status: string; error: string | null }>(
        sql`select status, error from integration_events where provider = 'slack' and direction = 'out' and kind = 'slack.chat.update' order by created_at desc limit 1`,
      )
    ).rows[0],
  ]);
  if (lead?.ack_status === 'acknowledged') {
    await new Promise((r) => setTimeout(r, 3000));
    break;
  }
}
const audit = await withWorkspaceTx(ws, async (tx) =>
  (
    await tx.execute<{ action: string }>(
      sql`select action from audit_events where target_id = ${pick.id} order by seq desc limit 3`,
    )
  ).rows.map((r) => r.action),
);
console.log(
  JSON.stringify(
    {
      ok: lead?.ack_status === 'acknowledged' && lead.acknowledged_via === 'slack',
      lead,
      alert: al,
      chatUpdate: out,
      audit,
    },
    null,
    2,
  ),
);
process.exit(0);
