// [I1.1][I1.2][I1.8][I1.4][I1.9][I1.10] WhatsApp webhook + messaging on real Postgres as app_user (T-141).
// Real signature computation over recorded-shape payloads; fake provider (no live calls).
import { randomUUID } from 'node:crypto';
import { closeDb, withWorkspaceTx } from '@relay/db';
import { workspaces } from '@relay/db/schema';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../src/auth/actor';
import {
  createFakeMeta,
  metaInboundPayload,
  metaStatusPayload,
  signedMetaRequest,
} from '../../src/integrations/meta/fake';
import { setMessaging } from '../../src/integrations/registry';
import { integrationsService } from '../../src/services/integrations';
import { deliverMessage, messagingService, processWhatsAppEvent } from '../../src/services/messaging';
import { registerInboundCustomerMessageHandler } from '../../src/services/messaging-hooks';
import { handleMetaHandshake, ingestWhatsApp } from '../../src/services/messaging-ingest';
import { withOwner } from '../../../db/test/helpers';

const RUN = randomUUID().slice(0, 8);
const ws = randomUUID();
const userId = randomUUID();
const SECRET = 'test-app-secret-0123456789abcdef';
const VERIFY = 'test-verify-token';
const PHONE = `9230${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const fake = createFakeMeta();
const actor: Actor = {
  userId,
  workspaceId: ws,
  sessionId: randomUUID(),
  baseLevel: 'owner',
  permissions: new Set(),
  locale: 'en',
};
let key = '';
const intake: Array<{ phone: string; text: string | null }> = [];

const post = (payload: unknown, secret = SECRET) => {
  const r = signedMetaRequest(secret, payload, `https://relay.test/api/webhooks/meta/${key}`);
  return ingestWhatsApp({ connectionKey: key, req: r, ip: '203.0.113.9' });
};
const count = async (q: string) => Number((await withOwner(async (c) => (await c.query(q, [ws])).rows))[0].n);

beforeAll(async () => {
  setMessaging(fake);
  registerInboundCustomerMessageHandler(async (_tx, m) => {
    intake.push({ phone: m.phone, text: m.text });
  });
  await withWorkspaceTx(ws, async (tx) => {
    await tx.insert(workspaces).values({ id: ws, name: 'WA WS', slug: `wa-${ws}` });
    await tx.execute(sql`insert into users (id, workspace_id, email, name, password_hash, base_level)
      values (${userId}, ${ws}, ${`u-${userId}@example.com`}, 'Ayesha', 'x', 'owner')`);
  });
  const conn = await integrationsService.connect(actor, 'meta_whatsapp', {
    secrets: { accessToken: 'EAAtesttesttesttesttesttest', appSecret: SECRET, verifyToken: VERIFY },
    publicConfig: { phoneNumberId: `PN-${RUN}` },
  });
  key = conn.connectionKey;
});

afterAll(async () => {
  setMessaging(null);
  await closeDb();
});

describe('webhook pipeline', () => {
  it('[I1.1] handshake echoes the challenge only for the right verify token', async () => {
    const url = (t: string) =>
      new URL(`https://relay.test/x?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=777`);
    const mk = (t: string) => ({ method: 'GET', url: url(t), headers: new Headers(), rawBody: '' });
    const ok = await handleMetaHandshake(key, mk(VERIFY));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('777');
    expect((await handleMetaHandshake(key, mk('nope'))).status).toBe(403);
  });

  it('[I1.2] forged signature -> 401, recorded as rejected, no conversation or message', async () => {
    const wamid = `wamid.FORGED${RUN}`;
    const res = await post(
      metaInboundPayload({ wamid, from: PHONE, phoneNumberId: `PN-${RUN}` }),
      'wrong-secret',
    );
    expect(res.status).toBe(401);
    expect(res.newEvents).toHaveLength(0);
    expect(
      await count(
        `select count(*) n from integration_events where workspace_id = $1 and status = 'rejected' and provider = 'meta_whatsapp'`,
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(await count(`select count(*) n from conversations where workspace_id = $1`)).toBe(0);
  });

  it('[I1.8] duplicate wamid stores one message (and calls intake once)', async () => {
    const wamid = `wamid.DUP${RUN}`;
    const payload = metaInboundPayload({
      wamid,
      from: PHONE,
      name: 'Bilal',
      text: 'salam price?',
      phoneNumberId: `PN-${RUN}`,
    });
    const a = await post(payload);
    const b = await post(payload);
    expect(a.newEvents).toHaveLength(1);
    expect(b.newEvents).toHaveLength(0); // duplicate: nothing enqueued
    for (const e of a.newEvents) await processWhatsAppEvent(e.eventId, e.workspaceId);
    expect(await count(`select count(*) n from messages where workspace_id = $1 and direction = 'in'`)).toBe(
      1,
    );
    expect(
      await count(
        `select duplicate_count n from integration_events where workspace_id = $1 and kind = 'whatsapp.message'`,
      ),
    ).toBe(1);
    expect(intake).toEqual([{ phone: `+${PHONE}`, text: 'salam price?' }]);
  });
});

describe('send rules + status', () => {
  let conversationId = '';
  beforeAll(async () => {
    conversationId = (await messagingService.listConversations(actor, { filter: 'all', limit: 10 }))
      .conversations[0]!.id;
  });

  it('[I1.10] outside the 24 h window free text is blocked; a template is accepted', async () => {
    const late = new Date(Date.now() + 25 * 3600_000);
    await expect(
      messagingService.send(actor, conversationId, { kind: 'text', text: 'hi' }, late),
    ).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      details: { reason: 'window_closed' },
    });
    const m = await messagingService.send(
      actor,
      conversationId,
      { kind: 'template', templateKey: 'hello_world', params: [] },
      late,
    );
    expect(m.kind).toBe('template');
    expect(m.status).toBe('queued');
  });

  it('[I1.3][I1.4] text inside the window is delivered; statuses only move forward', async () => {
    const m = await messagingService.send(actor, conversationId, {
      kind: 'text',
      text: 'Quote attached',
      clientKey: `k-${RUN}`,
    });
    const again = await messagingService.send(actor, conversationId, {
      kind: 'text',
      text: 'Quote attached',
      clientKey: `k-${RUN}`,
    });
    expect(again.id).toBe(m.id); // idempotent composer submit
    await deliverMessage(ws, m.id, { attempt: 1, maxAttempts: 6, now: new Date() });
    const wamid = fake.sent.find((s) => s.body === 'Quote attached')!.id;
    for (const status of ['read', 'delivered', 'sent'] as const) {
      const r = await post(metaStatusPayload({ wamid, status, to: PHONE, phoneNumberId: `PN-${RUN}` }));
      for (const e of r.newEvents) await processWhatsAppEvent(e.eventId, e.workspaceId, true);
    }
    const row = (await messagingService.listMessages(actor, conversationId, { limit: 50 })).messages.find(
      (x) => x.id === m.id,
    )!;
    expect(row.status).toBe('read'); // 'delivered'/'sent' arriving late did not regress it
  });

  it('[I1.7] a permanent provider failure marks the message failed with a plain reason; retry re-queues', async () => {
    const m = await messagingService.send(actor, conversationId, { kind: 'text', text: 'will fail' });
    const { ProviderError } = await import('../../src/integrations/types');
    fake.failNext = new ProviderError('permanent', 'recipient_not_allowed', 'meta 400 code=131030');
    await expect(
      deliverMessage(ws, m.id, { attempt: 1, maxAttempts: 6, now: new Date() }),
    ).rejects.toBeInstanceOf(ProviderError);
    let row = (await messagingService.listMessages(actor, conversationId, { limit: 50 })).messages.find(
      (x) => x.id === m.id,
    )!;
    expect(row).toMatchObject({ status: 'failed', statusReason: 'recipient_not_allowed' });
    const re = await messagingService.retry(actor, conversationId, m.id);
    expect(re.status).toBe('queued');
    await deliverMessage(ws, m.id, { attempt: 1, maxAttempts: 6, now: new Date() });
    row = (await messagingService.listMessages(actor, conversationId, { limit: 50 })).messages.find(
      (x) => x.id === m.id,
    )!;
    expect(row.status).toBe('sent');
  });

  it('[I1.9] opted-out conversations cannot be messaged', async () => {
    await messagingService.setOptOut(actor, conversationId, true);
    await expect(
      messagingService.send(actor, conversationId, { kind: 'text', text: 'x' }),
    ).rejects.toMatchObject({
      details: { reason: 'opted_out' },
    });
    await messagingService.setOptOut(actor, conversationId, false);
  });

  it('[F1.6] another workspace cannot see the conversation (404)', async () => {
    const other: Actor = { ...actor, workspaceId: randomUUID() };
    await withWorkspaceTx(other.workspaceId, (tx) =>
      tx.insert(workspaces).values({ id: other.workspaceId, name: 'Other', slug: `o-${other.workspaceId}` }),
    );
    await expect(messagingService.listMessages(other, conversationId, { limit: 5 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
