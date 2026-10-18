// [I2.1][I2.3][I2.4][I2.5][I2.6] Stripe payments on real Postgres as app_user (T-143). Real signature computation,
// fake outbound calls. Needs the audit/identity tables (Lane B) and the outbox (Lane A).
import { randomUUID } from 'node:crypto';
import { closeDb, withWorkspaceTx } from '@relay/db';
import { workspaces } from '@relay/db/schema';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwner } from '../../../db/test/helpers';
import type { Actor } from '../../src/auth/actor';
import { setPaymentProvider } from '../../src/integrations/registry';
import { createFakeStripe, signStripePayload, stripeEventBody } from '../../src/integrations/stripe/fake';
import { integrationsService } from '../../src/services/integrations';
import { createRequest, list, processStripeEvent } from '../../src/services/payments';
import { ingestStripe } from '../../src/services/stripe-ingest';

const RUN = randomUUID().slice(0, 8);
const ws = randomUUID();
const userId = randomUUID();
const WHSEC = 'whsec_test_secret_for_contract_tests_0123456789';
const fake = createFakeStripe();
const actor: Actor = {
  userId,
  workspaceId: ws,
  sessionId: randomUUID(),
  baseLevel: 'owner',
  permissions: new Set(),
  locale: 'en',
};
let ready = false;
let key = '';
let prId = '';
let sessionId = '';

beforeAll(async () => {
  const have = await withOwner(async (c) => {
    const r = await c.query(
      `select to_regclass('public.users') u, to_regclass('public.audit_events') a, to_regclass('public.outbox') o`,
    );
    return Object.values(r.rows[0]).every(Boolean);
  });
  if (!have) return console.warn('[payments.test] SKIPPED: users/audit_events/outbox tables missing');
  ready = true;
  setPaymentProvider(fake);
  await withWorkspaceTx(ws, async (tx) => {
    await tx.insert(workspaces).values({ id: ws, name: 'Pay WS', slug: `pay-${ws}` });
    await tx.execute(sql`insert into users (id, workspace_id, email, name, password_hash, base_level)
      values (${userId}, ${ws}, ${`u-${userId}@example.com`}, 'Ayesha', 'x', 'owner')`);
  });
  const dto = await integrationsService.connect(actor, 'stripe', {
    secrets: { secretKey: 'sk_test_fake_0123456789', webhookSecret: WHSEC },
  });
  key = dto.connectionKey;
});

afterAll(async () => {
  setPaymentProvider(null);
  await closeDb();
});

const hook = (type: string, id: string, object: Record<string, unknown>, secret = WHSEC) => {
  const rawBody = stripeEventBody({ id, type, object });
  return {
    connectionKey: key,
    ip: '203.0.113.9',
    req: {
      method: 'POST',
      url: new URL(`https://relay.test/api/webhooks/stripe/${key}`),
      headers: new Headers({ 'stripe-signature': signStripePayload(rawBody, secret) }),
      rawBody,
    },
  };
};
const status = async () =>
  (
    await withWorkspaceTx(ws, (tx) =>
      tx.execute<{ status: string }>(sql`select status from payment_requests where id = ${prId}`),
    )
  ).rows[0]?.status;
const count = async (q: ReturnType<typeof sql>) =>
  Number((await withWorkspaceTx(ws, (tx) => tx.execute<{ n: string }>(q))).rows[0]?.n);

describe('[I2.1] create a payment request', () => {
  it('[I2.1] creates a pending request + Checkout Session (PKR shown, USD billed), audited; amounts hidden without value permission', async (ctx) => {
    if (!ready) return ctx.skip();
    const dto = await createRequest(actor, randomUUID(), {
      amountMinor: 5_000_000,
      currency: 'PKR',
      description: 'Deposit',
    });
    prId = dto.id;
    sessionId = dto.providerRef ?? '';
    expect(dto.status).toBe('pending');
    expect(dto.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(dto.amount).toEqual({ masked: false, amountMinor: 17_857, currency: 'USD' });
    expect(dto.displayText).toBe('PKR 50,000');
    expect(fake.created[0]?.idempotencyKey).toBe(`pay:${dto.id}`);
    const lowly: Actor = { ...actor, baseLevel: 'user', permissions: new Set(['payments.request']) };
    const mine = await list(lowly, { limit: 10 });
    expect(mine.requests[0]?.amount).toEqual({ masked: true }); // F1.4: no value permission -> masked
    expect(mine.requests[0]?.displayText).toBeNull();
    expect(mine.totals.collected.masked).toBe(true);
    const other = await list({ ...lowly, userId: randomUUID() }, { limit: 10 });
    expect(other.requests).toHaveLength(0); // F1.5: someone else's request is out of scope
    const seen = await list(actor, { limit: 10 });
    expect(seen.totals.projected).toEqual({ value: 17_857, masked: false });
  });
});

describe('[I2.3] webhook authenticity', () => {
  it('[I2.3] forged signature -> 400, recorded as rejected, payment untouched', async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await ingestStripe(
      hook(
        'checkout.session.completed',
        `evt_forged_${RUN}`,
        { id: sessionId, payment_status: 'paid', metadata: { payment_request_id: prId } },
        'whsec_wrong_secret',
      ),
    );
    expect(r.status).toBe(400);
    expect(r.newEvents).toHaveLength(0);
    expect(await status()).toBe('pending');
    expect(
      await count(
        sql`select count(*) n from integration_events where provider='stripe' and status='rejected' and error='bad_signature'`,
      ),
    ).toBeGreaterThan(0);
    expect(
      await count(
        sql`select count(*) n from integration_events where external_event_id = ${`evt_forged_${RUN}`}`,
      ),
    ).toBe(0);
  });
});

describe('[I2.2][I2.4] paid + idempotency', () => {
  const evtId = `evt_paid_${RUN}`;
  it('[I2.2] a signed checkout.session.completed flips the request to paid and writes the ledger', async (ctx) => {
    if (!ready) return ctx.skip();
    const h = hook('checkout.session.completed', evtId, {
      id: sessionId,
      payment_status: 'paid',
      payment_intent: `pi_${RUN}`,
      amount_total: 17_857,
      currency: 'usd',
      metadata: { payment_request_id: prId },
    });
    const r = await ingestStripe(h);
    expect(r.status).toBe(200);
    expect(r.newEvents).toHaveLength(1);
    await processStripeEvent(r.newEvents[0]!.eventId, ws);
    expect(await status()).toBe('paid');
    const res = await list(actor, { limit: 10 });
    expect(res.totals.collected).toEqual({ value: 17_857, masked: false });
    expect(res.totals.projected.value).toBe(0);
  });

  it('[I2.4] the same event delivered again is recorded once and changes nothing', async (ctx) => {
    if (!ready) return ctx.skip();
    const h = hook('checkout.session.completed', evtId, {
      id: sessionId,
      payment_status: 'paid',
      payment_intent: `pi_${RUN}`,
      amount_total: 17_857,
      currency: 'usd',
      metadata: { payment_request_id: prId },
    });
    const r = await ingestStripe(h);
    expect(r.status).toBe(200);
    expect(r.newEvents).toHaveLength(0);
    expect(
      await count(sql`select count(*) n from integration_events where external_event_id = ${evtId}`),
    ).toBe(1);
    expect(
      await count(sql`select duplicate_count n from integration_events where external_event_id = ${evtId}`),
    ).toBe(1);
    expect(
      await count(sql`select count(*) n from payments where payment_request_id = ${prId} and kind='charge'`),
    ).toBe(1);
  });

  it('[I2.4] a different event id for the same charge cannot double-record (UNIQUE provider_ref+kind)', async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await ingestStripe(
      hook('checkout.session.async_payment_succeeded', `evt_other_${RUN}`, {
        id: sessionId,
        payment_status: 'paid',
        payment_intent: `pi_${RUN}`,
        amount_total: 17_857,
        currency: 'usd',
        metadata: { payment_request_id: prId },
      }),
    );
    await processStripeEvent(r.newEvents[0]!.eventId, ws);
    expect(
      await count(sql`select count(*) n from payments where payment_request_id = ${prId} and kind='charge'`),
    ).toBe(1);
  });
});

describe('[I2.5][I2.6] refund + out-of-order', () => {
  it('[I2.5] a late expired after paid is ignored', async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await ingestStripe(
      hook('checkout.session.expired', `evt_exp_${RUN}`, {
        id: sessionId,
        metadata: { payment_request_id: prId },
      }),
    );
    await processStripeEvent(r.newEvents[0]!.eventId, ws);
    expect(await status()).toBe('paid');
  });

  it('[I2.5][I2.6] charge.refunded (partial, then full) updates status and collected = charges - refunds', async (ctx) => {
    if (!ready) return ctx.skip();
    const charge = (refunded: number) => ({
      id: `ch_${RUN}`,
      payment_intent: `pi_${RUN}`,
      amount: 17_857,
      amount_refunded: refunded,
      currency: 'usd',
      metadata: { payment_request_id: prId },
    });
    const a = await ingestStripe(hook('charge.refunded', `evt_ref1_${RUN}`, charge(5_000)));
    await processStripeEvent(a.newEvents[0]!.eventId, ws);
    expect(await status()).toBe('partially_refunded');
    expect((await list(actor, { limit: 10 })).totals.collected.value).toBe(12_857);
    const b = await ingestStripe(hook('charge.refunded', `evt_ref2_${RUN}`, charge(17_857)));
    await processStripeEvent(b.newEvents[0]!.eventId, ws);
    expect(await status()).toBe('refunded');
    expect((await list(actor, { limit: 10 })).totals.collected.value).toBe(0);
  });
});
