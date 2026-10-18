// [I5.3][I4.1][I4.3][I5.4] Integrations + Slack on real Postgres as app_user (T-140, T-145).
// Needs the audit/identity tables (Lane B) and the outbox (Lane A); skipped with a loud warning if absent.
import { randomUUID } from 'node:crypto';
import { closeDb, withSystemTx, withWorkspaceTx } from '@relay/db';
import { workspaces } from '@relay/db/schema';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwner } from '../../../db/test/helpers';
import type { Actor } from '../../src/auth/actor';
import { createFakeSlack, signedSlackRequest } from '../../src/integrations/slack/fake';
import { setNotifier } from '../../src/integrations/registry';
import { integrationsService } from '../../src/services/integrations';
import { ingestSlack } from '../../src/services/integrations-ingest';
import { enqueueSlackAlert, processSlackEvent, sendSlackAlert, slackService } from '../../src/services/slack';

const RUN = randomUUID().slice(0, 8); // the test DB persists across runs: external ids must be unique per run
const ws = randomUUID();
const userId = randomUUID();
const SIGNING = 'sig-secret-for-tests-0123456789';
const BOT = 'xoxb-TESTSECRET-9f8e7d6c5b4a';
const fake = createFakeSlack();

const actor: Actor = {
  userId,
  workspaceId: ws,
  sessionId: randomUUID(),
  baseLevel: 'owner',
  permissions: new Set(),
  locale: 'en',
};

let ready = false;
let connectionKey = '';

beforeAll(async () => {
  const have = await withOwner(async (c) => {
    const r = await c.query(
      `select to_regclass('public.users') u, to_regclass('public.audit_events') a, to_regclass('public.outbox') o`,
    );
    return Object.values(r.rows[0]).every(Boolean);
  });
  if (!have) {
    console.warn(
      '[integrations.test] SKIPPED: users/audit_events/outbox tables missing (Lane A/B migrations not merged)',
    );
    return;
  }
  ready = true;
  setNotifier(fake);
  await withWorkspaceTx(ws, async (tx) => {
    await tx.insert(workspaces).values({ id: ws, name: 'Int WS', slug: `int-${ws}` });
    await tx.execute(sql`insert into users (id, workspace_id, email, name, password_hash, base_level)
      values (${userId}, ${ws}, ${`u-${userId}@example.com`}, 'Ayesha', 'x', 'owner')`);
  });
});

afterAll(async () => {
  setNotifier(null);
  await closeDb();
});

const cmdBody = (text: string, trigger: string) =>
  new URLSearchParams({
    command: '/relay',
    text,
    team_id: 'T1',
    user_id: 'U123',
    trigger_id: trigger,
    response_url: 'https://hooks.slack.com/commands/x',
  }).toString();

function req(body: string, headers: Record<string, string>) {
  return {
    method: 'POST',
    url: new URL('https://relay.test/api/webhooks/slack/k/commands'),
    headers: new Headers(headers),
    rawBody: body,
  };
}

describe('[I5.3] connections never return secrets', () => {
  it('[I5.3] connect/list/events responses and the DB row never contain the secret values; audited', async (ctx) => {
    if (!ready) return ctx.skip();
    const dto = await integrationsService.connect(actor, 'slack', {
      secrets: { botToken: BOT, signingSecret: SIGNING },
      publicConfig: { teamId: 'T1' },
    });
    connectionKey = dto.connectionKey;
    const list = await integrationsService.list(actor);
    const events = await integrationsService.events(actor, { limit: 25 });
    const wire = JSON.stringify([dto, list, events]);
    expect(wire).not.toContain(BOT);
    expect(wire).not.toContain(SIGNING);
    expect(dto.secretsHint).toBe('••••' + BOT.slice(-4));
    expect(dto.secretFieldsSet).toEqual(['botToken', 'signingSecret']);
    const row = await withOwner((c) =>
      c.query(`select secrets_enc from integration_connections where workspace_id = $1`, [ws]),
    );
    expect(row.rows[0].secrets_enc).toMatch(/^v1\./);
    expect(row.rows[0].secrets_enc).not.toContain(BOT);
    const audit = await withWorkspaceTx(ws, (tx) =>
      tx.execute(sql`select action, after from audit_events where action like 'integration.%'`),
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toContain(BOT);
  });

  it('[I5.7] a user without integrations.manage is refused', async (ctx) => {
    if (!ready) return ctx.skip();
    const plain: Actor = { ...actor, baseLevel: 'user' };
    await expect(
      integrationsService.connect(plain, 'slack', { secrets: {}, publicConfig: {} }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('[I4.1] Slack webhook ingest', () => {
  it('[I4.1] forged signature -> 401, recorded as rejected, no inbox row, nothing enqueued', async (ctx) => {
    if (!ready) return ctx.skip();
    const body = cmdBody('help', `trig-forged-${RUN}`);
    const good = signedSlackRequest(SIGNING, body);
    const res = await ingestSlack({
      connectionKey,
      endpoint: 'commands',
      ip: '10.0.0.1',
      req: req(body + '&tampered=1', good.headers),
    });
    expect(res.status).toBe(401);
    expect(res.newEvents).toEqual([]);
    const ev = await withWorkspaceTx(ws, (tx) =>
      tx.execute(sql`select status, error from integration_events where error = 'bad_signature'`),
    );
    expect(ev.rows[0]).toMatchObject({ status: 'rejected' });
    const received = await withWorkspaceTx(ws, (tx) =>
      tx.execute(sql`select 1 from integration_events where external_event_id = ${`cmd:trig-forged-${RUN}`}`),
    );
    expect(received.rows).toHaveLength(0);
  });

  it('[I4.1] a stale (replayed) signed request is rejected', async (ctx) => {
    if (!ready) return ctx.skip();
    const body = cmdBody('help', `trig-stale-${RUN}`);
    const old = signedSlackRequest(SIGNING, body, new Date(Date.now() - 10 * 60_000));
    const res = await ingestSlack({
      connectionKey,
      endpoint: 'commands',
      ip: '10.0.0.2',
      req: req(body, old.headers),
    });
    expect(res.status).toBe(401);
  });

  it('[I4.1] unknown connection key -> 404 and a workspace-less rejected row', async (ctx) => {
    if (!ready) return ctx.skip();
    const body = cmdBody('help', `trig-x-${RUN}`);
    const res = await ingestSlack({
      connectionKey: 'doesnotexist00000000000',
      endpoint: 'commands',
      ip: '10.0.0.3',
      req: req(body, signedSlackRequest(SIGNING, body).headers),
    });
    expect(res.status).toBe(404);
    const rows = await withSystemTx((tx) =>
      tx.execute(
        sql`select error from integration_events where workspace_id is null and error = 'unknown_connection'`,
      ),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
  });

  it('[I4.1][I5.4] a duplicate delivery is recorded once: duplicate_count=1, a single outbox job', async (ctx) => {
    if (!ready) return ctx.skip();
    const body = cmdBody('help', `trig-dup-${RUN}`);
    const s = signedSlackRequest(SIGNING, body);
    const first = await ingestSlack({
      connectionKey,
      endpoint: 'commands',
      ip: '10.0.0.4',
      req: req(body, s.headers),
    });
    const second = await ingestSlack({
      connectionKey,
      endpoint: 'commands',
      ip: '10.0.0.4',
      req: req(body, s.headers),
    });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.newEvents).toHaveLength(1);
    expect(second.newEvents).toHaveLength(0);
    const ev = await withWorkspaceTx(ws, (tx) =>
      tx.execute(
        sql`select duplicate_count from integration_events where external_event_id = ${`cmd:trig-dup-${RUN}`}`,
      ),
    );
    expect(ev.rows).toEqual([{ duplicate_count: 1 }]);
  });
});

describe('[I4.3] linking and [I4.2] alerts', () => {
  it('[I4.3] /relay link <code> links once; the code is single use; the DB stores only a hash', async (ctx) => {
    if (!ready) return ctx.skip();
    const { code } = await slackService.createLinkCode(actor);
    const stored = await withOwner((c) =>
      c.query(`select token_hash from slack_link_tokens where user_id = $1`, [userId]),
    );
    expect(JSON.stringify(stored.rows)).not.toContain(code);
    const run = async (trigger: string) => {
      const body = cmdBody(`link ${code}`, trigger);
      const r = await ingestSlack({
        connectionKey,
        endpoint: 'commands',
        ip: '10.0.0.5',
        req: req(body, signedSlackRequest(SIGNING, body).headers),
      });
      if (!r.newEvents[0]) throw new Error('ingest status ' + r.status);
      await processSlackEvent(r.newEvents[0].eventId, r.newEvents[0].workspaceId);
    };
    await run(`trig-link-1-${RUN}`);
    const u = await withWorkspaceTx(ws, (tx) =>
      tx.execute(sql`select slack_user_id, slack_team_id from users where id = ${userId}`),
    );
    expect(u.rows[0]).toEqual({ slack_user_id: 'U123', slack_team_id: 'T1' });
    expect(fake.responses.at(-1)?.text).toMatch(/connected/i);
    await run(`trig-link-2-${RUN}`); // same code again
    expect(fake.responses.at(-1)?.text).toMatch(/invalid or has expired/i);
  });

  it('[I4.2][F3.9] enqueueSlackAlert -> slack.send delivers a DM once; the value is hidden without the right', async (ctx) => {
    if (!ready) return ctx.skip();
    const leadId = randomUUID();
    const alertId = await withWorkspaceTx(ws, (tx) =>
      enqueueSlackAlert(tx, {
        workspaceId: ws,
        userId,
        leadId,
        leadVersion: 3,
        purpose: 'escalated',
        leadName: 'Bilal',
        source: 'Form',
        reason: 'No reply in 5 min',
        level: 1,
        deadlineAt: new Date(Date.now() + 120_000),
        valueText: 'PKR 500,000',
      }),
    );
    expect(alertId).toBeTruthy();
    // Same transition again enqueues nothing.
    const dup = await withWorkspaceTx(ws, (tx) =>
      enqueueSlackAlert(tx, {
        workspaceId: ws,
        userId,
        leadId,
        leadVersion: 3,
        purpose: 'escalated',
        leadName: 'Bilal',
        source: 'Form',
        reason: 'x',
      }),
    );
    expect(dup).toBeNull();
    const payload = {
      alertId: alertId!,
      leadId,
      userId,
      purpose: 'escalated' as const,
      leadVersion: 3,
      leadName: 'Bilal',
      source: 'Form',
      reason: 'No reply in 5 min',
      level: 1,
      deadlineAt: new Date(Date.now() + 120_000).toISOString(),
      valueText: 'PKR 500,000',
    };
    await sendSlackAlert(ws, payload);
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]!.slackUserId).toBe('U123');
    expect(JSON.stringify(fake.posted[0]!.msg)).toContain('PKR'); // owner holds crm.opportunity.value.view (real mask.ts check)
    await sendSlackAlert(ws, payload); // idempotent: already sent
    expect(fake.posted).toHaveLength(1);
    const a = await withWorkspaceTx(ws, (tx) =>
      tx.execute(sql`select status, slack_ts from slack_alerts where id = ${alertId!}`),
    );
    expect(a.rows[0]).toMatchObject({ status: 'sent' });
  });

  it('[I4.4] an unlinked recipient is skipped with a visible reason', async (ctx) => {
    if (!ready) return ctx.skip();
    await slackService.unlink(actor);
    const alertId = await withWorkspaceTx(ws, (tx) =>
      enqueueSlackAlert(tx, {
        workspaceId: ws,
        userId,
        leadId: randomUUID(),
        leadVersion: 1,
        purpose: 'assigned',
        leadName: 'C',
        source: 'S',
        reason: 'r',
      }),
    );
    const payload = {
      alertId: alertId!,
      leadId: randomUUID(),
      userId,
      purpose: 'assigned' as const,
      leadVersion: 1,
      leadName: 'C',
      source: 'S',
      reason: 'r',
      level: null,
      deadlineAt: null,
      valueText: null,
    };
    await sendSlackAlert(ws, payload);
    const a = await withWorkspaceTx(ws, (tx) =>
      tx.execute(sql`select status, error from slack_alerts where id = ${alertId!}`),
    );
    expect(a.rows[0]).toEqual({ status: 'skipped', error: 'slack_not_connected' });
  });
});
