// Manual REAL check against Stripe test mode through the app's own service + webhook route (not the fake):
//   pnpm tsx scripts/stripe-smoke.ts register   -> create the webhook endpoint at PUBLIC_WEBHOOK_URL, store whsec in
//                                                  apps/web/.env.local (never printed); prints only "created, id=we_…"
//   pnpm tsx scripts/stripe-smoke.ts pay        -> create a real Checkout Session via payments.createRequest, then POST a
//                                                  correctly signed checkout.session.completed to the LOCAL webhook route
//                                                  (http://localhost:$PORT) and confirm the request flips to paid.
// Secrets are loaded from the env files and never printed.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

for (const f of ['apps/web/.env.local', '.env.secrets.local', '.env.local']) {
  if (existsSync(f)) process.loadEnvFile(f);
}
const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith('sk_test_')) {
  console.log(
    JSON.stringify({ ok: false, reason: 'STRIPE_SECRET_KEY (test) not available in this environment' }),
  );
  process.exit(2);
}
const mode = process.argv[2] ?? 'pay';

if (mode === 'register') {
  const auth = { authorization: `Bearer ${key}` };
  const url =
    process.env.PUBLIC_WEBHOOK_URL ?? 'https://relay-eta-silk.vercel.app/api/webhooks/stripe/default';
  const listed = (await (
    await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=100', { headers: auth })
  ).json()) as {
    data?: Array<{ id: string; url: string }>;
  };
  const existing = listed.data?.find((e) => e.url === url);
  if (existing) {
    console.log(
      `endpoint already exists, id=${existing.id} (signing secret is only shown at creation; reuse the stored one)`,
    );
    process.exit(0);
  }
  const form = new URLSearchParams({ url, description: 'Relay (T-143)' });
  [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
    'payment_intent.payment_failed',
    'charge.refunded',
  ].forEach((e, i) => form.set(`enabled_events[${i}]`, e));
  const ep = (await (
    await fetch('https://api.stripe.com/v1/webhook_endpoints', { method: 'POST', headers: auth, body: form })
  ).json()) as {
    id?: string;
    secret?: string;
    error?: { message: string };
  };
  if (!ep.id || !ep.secret) {
    console.log('create failed:', ep.error?.message ?? 'unknown');
    process.exit(1);
  }
  const f = 'apps/web/.env.local';
  const kept = existsSync(f)
    ? readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => !l.startsWith('STRIPE_WEBHOOK_SECRET='))
    : [];
  writeFileSync(f, kept.join('\n').replace(/\n*$/, '\n'));
  appendFileSync(f, `STRIPE_WEBHOOK_SECRET="${ep.secret}"\n`);
  console.log(`created, id=${ep.id}`);
  process.exit(0);
}

// ── pay ────────────────────────────────────────────────────────────────
const { closeDb, withWorkspaceTx } = await import('../packages/db/src/index');
const { workspaces } = await import('../packages/db/src/schema/index');
const { sql } = await import('../packages/core/node_modules/drizzle-orm');
const { createRequest } = await import('../packages/core/src/services/payments');
const { signStripePayload, stripeEventBody } = await import('../packages/core/src/integrations/stripe/fake');

const ws = randomUUID();
const userId = randomUUID();
await withWorkspaceTx(ws, async (tx) => {
  await tx.insert(workspaces).values({ id: ws, name: 'Stripe smoke', slug: `smoke-${ws}` });
  await tx.execute(sql`insert into users (id, workspace_id, email, name, password_hash, base_level)
    values (${userId}, ${ws}, ${`smoke-${userId}@example.com`}, 'Smoke', 'x', 'owner')`);
});
const actor = {
  userId,
  workspaceId: ws,
  sessionId: randomUUID(),
  baseLevel: 'owner' as const,
  permissions: new Set<never>(),
  locale: 'en' as const,
};
const dto = await createRequest(actor, randomUUID(), {
  amountMinor: 5_000_000,
  currency: 'PKR',
  description: 'Relay smoke deposit',
});
console.log(
  JSON.stringify({
    step: 'checkout_created',
    paymentRequestId: dto.id,
    sessionId: dto.providerRef,
    url: dto.url,
    amount: dto.amount,
    displayText: dto.displayText,
    status: dto.status,
  }),
);

const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret?.startsWith('whsec_') || secret === 'whsec_') {
  console.log('no STRIPE_WEBHOOK_SECRET: run `register` first to simulate the completion event');
  await closeDb();
  process.exit(0);
}
const body = stripeEventBody({
  id: `evt_smoke_${randomUUID().slice(0, 12)}`,
  type: 'checkout.session.completed',
  object: {
    id: dto.providerRef,
    payment_status: 'paid',
    payment_intent: `pi_smoke_${randomUUID().slice(0, 12)}`,
    amount_total: dto.amount.masked ? 0 : dto.amount.amountMinor,
    currency: 'usd',
    metadata: { payment_request_id: dto.id },
  },
});
const port = process.env.PORT ?? '3000';
const hook = `http://localhost:${port}/api/webhooks/stripe/default`;
const forged = await fetch(hook, {
  method: 'POST',
  headers: { 'stripe-signature': signStripePayload(body, 'whsec_forged_forged_forged_forged') },
  body,
});
console.log(JSON.stringify({ step: 'forged_signature', httpStatus: forged.status }));
const res = await fetch(hook, {
  method: 'POST',
  headers: { 'stripe-signature': signStripePayload(body, secret) },
  body,
});
console.log(JSON.stringify({ step: 'signed_event_posted', httpStatus: res.status }));
let status = 'pending';
for (let i = 0; i < 20 && status !== 'paid'; i++) {
  await new Promise((r) => setTimeout(r, 500));
  status =
    (
      await withWorkspaceTx(ws, (tx) =>
        tx.execute<{ status: string }>(sql`select status from payment_requests where id = ${dto.id}`),
      )
    ).rows[0]?.status ?? 'missing';
}
console.log(JSON.stringify({ step: 'result', paymentRequestId: dto.id, status }));
await closeDb();
process.exit(status === 'paid' ? 0 : 1);
