// Payments service (T-143; I2.1-I2.8). Owner: Lane C.
//  - createRequest: payment_requests row + outbox `payment.create_checkout` in ONE tx, then (outside any tx)
//    the Checkout Session is created; the outbox job is the retry safety net (same idempotent function).
//  - processStripeEvent: apply a recorded, signature-verified event: monotonic status, ledger rows
//    (UNIQUE provider_ref+kind), timeline + thread event, realtime. All in one tx; no provider calls.
//  - list/totals: collected (Σ charge − Σ refund) vs projected (open requests) (I2.6); amounts masked (F1.4).
// Provider calls NEVER happen inside a DB transaction.
import type {
  CreatePaymentLinkInput,
  PaymentRequestDto,
  PaymentsListResponse,
} from '@relay/contracts/api/payments';
import { withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../auth/actor';
import { canSeeValue, maskMoney, maskMoneyFigure } from '../auth/mask';
import { assertPermission } from '../auth/permissions';
import { contactScopeSql, foundOr404 } from '../auth/visibility';
import { config } from '../config';
import {
  chargeFor,
  clampExpiryMinutes,
  nextPaymentStatus,
  paymentLinkText,
  type PaymentStatus,
} from '../domain/payments';
import { AppError } from '../errors';
import { breakerAllows, type Breaker } from '../integrations/breaker';
import { redactText } from '../integrations/redact';
import { getPaymentProvider } from '../integrations/registry';
import type { NormalizedStripeEvent } from '../integrations/stripe/normalize';
import { ProviderError } from '../integrations/types';
import { appendAudit, enqueueJob } from '../integrations/upstream';
import { DeferJobError } from '../jobs/policy';
import { log } from '../log';
import { emit } from '../realtime';
import { ensurePlatformConnection, getWorkspaceConnection, recordOutcome } from './integrations';
import { mergeStripeCreds } from './stripe-ingest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

type PrRow = {
  id: string;
  workspace_id: string;
  opportunity_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  requested_by: string | null;
  amount_minor: string | number;
  currency: string;
  display_text: string | null;
  description: string | null;
  provider_ref: string | null;
  payment_intent_ref: string | null;
  url: string | null;
  status: PaymentStatus;
  failure_reason: string | null;
  paid_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
  version: number;
};

const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());

const tableExists = async (tx: Tx, name: string): Promise<boolean> =>
  !!(await tx.execute<{ t: string | null }>(sql`select to_regclass(${`public.${name}`}) as t`)).rows[0]?.t;

export function toDto(actor: Actor, r: PrRow): PaymentRequestDto {
  const amount = maskMoney(actor, Number(r.amount_minor), r.currency)!;
  return {
    id: r.id,
    opportunityId: r.opportunity_id,
    contactId: r.contact_id,
    conversationId: r.conversation_id,
    requestedBy: r.requested_by,
    amount,
    displayText: canSeeValue(actor) ? r.display_text : null,
    description: r.description,
    status: r.status,
    url: r.url,
    providerRef: r.provider_ref,
    dashboardUrl: r.provider_ref
      ? `https://dashboard.stripe.com/test/checkout/sessions/${encodeURIComponent(r.provider_ref)}`
      : null,
    failureReason: r.failure_reason,
    paidAt: iso(r.paid_at),
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at)!,
    version: r.version,
  };
}

/** Visibility for payments: view_all, or own requests, or those of contacts in the actor's scope (06 §2). */
async function scopeSql(tx: Tx, actor: Actor) {
  const mine = sql`pr.requested_by = ${actor.userId}`;
  if (actor.baseLevel === 'owner' || actor.permissions.has('leads.view_all')) return sql`true`;
  if ((await tableExists(tx, 'leads')) && (await tableExists(tx, 'contacts'))) {
    return sql`(${mine} or (pr.contact_id is not null and ${contactScopeSql(actor, sql.raw('pr.contact_id'))}))`;
  }
  return mine;
}

// ── create (I2.1) ───────────────────────────────────────────────────────
export async function createRequest(
  actor: Actor,
  opportunityId: string,
  input: CreatePaymentLinkInput,
  now: Date = new Date(),
): Promise<PaymentRequestDto> {
  assertPermission(actor, 'payments.request');
  const row = await withWorkspaceTx(actor.workspaceId, async (tx) => {
    // The opportunity (Lane B2) may not be on main yet: when its table exists the id must resolve in scope.
    let opp: Loose | null = null;
    if (await tableExists(tx, 'opportunities')) {
      const scope =
        (await tableExists(tx, 'leads')) && (await tableExists(tx, 'contacts'))
          ? contactScopeSql(actor, sql.raw('o.contact_id'), sql.raw('o.owner_user_id'))
          : sql`true`;
      opp = foundOr404(
        (
          await tx.execute<Loose>(sql`select o.id, o.contact_id, o.title, o.value_minor, o.currency
            from opportunities o where o.id = ${opportunityId} and o.deleted_at is null and ${scope}`)
        ).rows[0],
      );
    }
    const amountMinor =
      input.amountMinor ??
      (opp && canSeeValue(actor) && opp.value_minor != null ? Number(opp.value_minor) : null);
    if (!amountMinor || amountMinor <= 0) {
      throw new AppError('VALIDATION_FAILED', {
        details: { in: 'body', issues: [{ path: 'amountMinor', code: 'required' }] },
      });
    }
    const currency = (input.currency ?? opp?.currency ?? 'PKR').toUpperCase();
    const s = config.stripe;
    const charge = chargeFor(amountMinor, currency, s.STRIPE_CHARGE_CURRENCY, s.STRIPE_PKR_PER_USD);
    const expiresAt = new Date(now.getTime() + clampExpiryMinutes(input.expiresInMinutes) * 60_000);
    const description = input.description ?? (opp?.title ? String(opp.title) : 'Payment');
    const ins = await tx.execute<PrRow>(sql`insert into payment_requests
      (workspace_id, opportunity_id, contact_id, conversation_id, requested_by, amount_minor, currency,
       display_text, description, expires_at)
      values (${actor.workspaceId}, ${opportunityId}, ${input.contactId ?? opp?.contact_id ?? null},
              ${input.conversationId ?? null}, ${actor.userId}, ${charge.amountMinor}, ${charge.currency},
              ${charge.displayText}, ${description}, ${expiresAt.toISOString()}::timestamptz)
      returning *`);
    const pr = ins.rows[0]!;
    await enqueueJob(tx, {
      type: 'payment.create_checkout',
      payload: { paymentRequestId: pr.id },
      dedupeKey: `pay:${pr.id}`,
    });
    await appendAudit(tx, actor, {
      action: 'payment.requested',
      targetType: 'payment_request',
      targetId: pr.id,
      after: { opportunityId, amountMinor: charge.amountMinor, currency: charge.currency },
    });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'payments', ids: [pr.id] });
    return pr;
  });

  // Fast path: create the session right away, outside any transaction. A failure leaves the outbox job to retry.
  try {
    await fulfillCheckout(actor.workspaceId, row.id, now);
  } catch (err) {
    log.warn('payments.inline_checkout_deferred', { paymentRequestId: row.id, err });
  }
  return getOne(actor, row.id);
}

async function getOne(actor: Actor, id: string): Promise<PaymentRequestDto> {
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const scope = await scopeSql(tx, actor);
    const r = (
      await tx.execute<PrRow>(sql`select pr.* from payment_requests pr where pr.id = ${id} and ${scope}`)
    ).rows[0];
    return toDto(actor, foundOr404(r));
  });
}

/**
 * payment.create_checkout (idempotent; Stripe idempotency key `pay:<id>`). read -> (tx closed) -> Stripe -> short write.
 * Safe to run twice concurrently: the update only fills an empty provider_ref.
 */
export async function fulfillCheckout(
  workspaceId: string,
  paymentRequestId: string,
  now: Date = new Date(),
): Promise<void> {
  const loaded = await withWorkspaceTx(workspaceId, async (tx) => {
    const r = (await tx.execute<PrRow>(sql`select * from payment_requests where id = ${paymentRequestId}`))
      .rows[0];
    if (!r || r.url || r.status !== 'pending') return null;
    const conn = await getWorkspaceConnection(tx, 'stripe');
    const health = conn?.health;
    const b: Breaker | null = health
      ? { state: health.state, failures: health.failures, openedAt: health.opened_at }
      : null;
    return { r, conn, b };
  });
  if (!loaded) return;
  const { r, conn, b } = loaded;
  if (b) {
    const gate = breakerAllows(b, now);
    if (!gate.allow) throw new DeferJobError(gate.retryInMs, 'stripe breaker open');
  }
  const base = config.core.PUBLIC_BASE_URL.replace(/\/$/, '');
  const provider = getPaymentProvider();
  let out;
  try {
    out = await provider.createCheckout(
      {
        amountMinor: Number(r.amount_minor),
        currency: r.currency,
        description: (r.display_text
          ? `${r.description ?? 'Payment'} (${r.display_text})`
          : (r.description ?? 'Payment')
        ).slice(0, 250),
        paymentRequestId: r.id,
        successUrl: `${base}/pay/success?pr=${r.id}`,
        cancelUrl: `${base}/pay/cancelled?pr=${r.id}`,
        expiresAt: r.expires_at ? new Date(r.expires_at) : undefined,
        idempotencyKey: `pay:${r.id}`,
      },
      mergeStripeCreds(conn),
    );
  } catch (err) {
    const pe =
      err instanceof ProviderError
        ? err
        : new ProviderError('temporary', 'stripe_error', String((err as Error).message));
    await recordOutcome(workspaceId, 'stripe', { ok: false, kind: pe.kind, code: pe.code }, now).catch(
      () => undefined,
    );
    // A permanent failure (e.g. below Stripe's minimum amount) is final: show it on the request.
    if (pe.kind === 'permanent') {
      await withWorkspaceTx(workspaceId, async (tx) => {
        await tx.execute(sql`update payment_requests set status = 'failed', failure_reason = ${redactText(pe.code, 200)},
          version = version + 1 where id = ${r.id} and status = 'pending' and url is null`);
        await emit(tx, { workspaceId, topic: 'payments', ids: [r.id] });
      });
    }
    throw pe;
  }
  await recordOutcome(workspaceId, 'stripe', { ok: true }, now).catch(() => undefined);
  await withWorkspaceTx(workspaceId, async (tx) => {
    await tx.execute(sql`update payment_requests set provider_ref = ${out.providerRef}, url = ${out.url},
      expires_at = ${out.expiresAt.toISOString()}::timestamptz, version = version + 1
      where id = ${r.id} and provider_ref is null`);
    await emit(tx, { workspaceId, topic: 'payments', ids: [r.id] });
  });
}

// ── cancel a pending link ───────────────────────────────────────────────
export async function cancelRequest(actor: Actor, id: string): Promise<PaymentRequestDto> {
  assertPermission(actor, 'payments.request');
  await withWorkspaceTx(actor.workspaceId, async (tx) => {
    const scope = await scopeSql(tx, actor);
    const r = foundOr404(
      (
        await tx.execute<PrRow>(
          sql`select pr.* from payment_requests pr where pr.id = ${id} and ${scope} for update of pr`,
        )
      ).rows[0],
    );
    if (r.status !== 'pending') {
      throw new AppError('BUSINESS_RULE_VIOLATION', {
        details: { reason: 'payment_not_pending', status: r.status },
      });
    }
    await tx.execute(
      sql`update payment_requests set status = 'expired', version = version + 1 where id = ${id}`,
    );
    if (r.provider_ref) {
      await enqueueJob(tx, {
        type: 'payment.expire_checkout',
        payload: { paymentRequestId: id },
        dedupeKey: `payx:${id}`,
      });
    }
    await appendAudit(tx, actor, {
      action: 'payment.cancelled',
      targetType: 'payment_request',
      targetId: id,
    });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'payments', ids: [id] });
  });
  return getOne(actor, id);
}

/** payment.expire_checkout job: tell Stripe the session is dead (best effort, idempotent). */
export async function expireCheckoutAtProvider(workspaceId: string, paymentRequestId: string): Promise<void> {
  const loaded = await withWorkspaceTx(workspaceId, async (tx) => {
    const r = (await tx.execute<PrRow>(sql`select * from payment_requests where id = ${paymentRequestId}`))
      .rows[0];
    if (!r?.provider_ref || r.status === 'paid') return null;
    return { ref: r.provider_ref, conn: await getWorkspaceConnection(tx, 'stripe') };
  });
  if (!loaded) return;
  await getPaymentProvider().expireCheckout(loaded.ref, mergeStripeCreds(loaded.conn));
}

// ── list + totals (I2.5-I2.7) ───────────────────────────────────────────
export async function list(
  actor: Actor,
  q: { status?: PaymentStatus; opportunityId?: string; limit: number },
): Promise<PaymentsListResponse> {
  assertPermission(actor, 'payments.request');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const scope = await scopeSql(tx, actor);
    const where = sql`${scope}
      ${q.status ? sql`and pr.status = ${q.status}` : sql``}
      ${q.opportunityId ? sql`and pr.opportunity_id = ${q.opportunityId}` : sql``}`;
    const rows = (
      await tx.execute<PrRow>(sql`select pr.* from payment_requests pr where ${where}
        order by pr.created_at desc limit ${q.limit}`)
    ).rows;
    const currency = config.stripe.STRIPE_CHARGE_CURRENCY.toUpperCase();
    const sums = (
      await tx.execute<{ charged: string | null; refunded: string | null; projected: string | null }>(sql`
        select
          (select coalesce(sum(p.amount_minor), 0) from payments p join payment_requests pr on pr.id = p.payment_request_id
             where p.kind = 'charge' and p.currency = ${currency} and ${scope}) as charged,
          (select coalesce(sum(p.amount_minor), 0) from payments p join payment_requests pr on pr.id = p.payment_request_id
             where p.kind = 'refund' and p.currency = ${currency} and ${scope}) as refunded,
          (select coalesce(sum(pr.amount_minor), 0) from payment_requests pr
             where pr.status = 'pending' and pr.currency = ${currency} and ${scope}) as projected`)
    ).rows[0]!;
    const charged = Number(sums.charged ?? 0);
    const refunded = Number(sums.refunded ?? 0);
    return {
      requests: rows.map((r) => toDto(actor, r)),
      totals: {
        currency,
        collected: maskMoneyFigure(actor, charged - refunded),
        projected: maskMoneyFigure(actor, Number(sums.projected ?? 0)),
        refunded: maskMoneyFigure(actor, refunded),
      },
    };
  });
}

/** WhatsApp delivery hook (Lane C3 sends): the localized message text for a ready link. */
export async function linkMessageText(
  workspaceId: string,
  paymentRequestId: string,
  locale: 'en' | 'ur',
): Promise<string | null> {
  const r = await withWorkspaceTx(
    workspaceId,
    async (tx) =>
      (await tx.execute<PrRow>(sql`select * from payment_requests where id = ${paymentRequestId}`)).rows[0],
  );
  if (!r?.url) return null;
  return paymentLinkText(
    {
      displayText: r.display_text,
      amountMinor: Number(r.amount_minor),
      currency: r.currency,
      description: r.description,
      url: r.url,
    },
    locale,
  );
}

// ── webhook event processing (I2.2, I2.4, I2.5) ─────────────────────────
const finish =
  (eventId: string, status: 'processed' | 'ignored' | 'failed', reference: string | null, error?: string) =>
  (tx: Tx) =>
    tx.execute(sql`update integration_events set status = ${status}, error = ${error ?? null},
      reference = coalesce(${reference}, reference), processed_at = now() where id = ${eventId}`);

/** `integration.process` for Stripe events. Idempotent: an already-processed event is a no-op. */
export async function processStripeEvent(eventId: string, workspaceId: string | null): Promise<void> {
  if (!workspaceId) return; // unattributed events are stored as ignored at ingest
  try {
    await withWorkspaceTx(workspaceId, async (tx) => {
      const ev = (
        await tx.execute<{ status: string; normalized: NormalizedStripeEvent | null }>(
          sql`select status, normalized from integration_events where id = ${eventId} for update`,
        )
      ).rows[0];
      if (!ev || ev.status !== 'received' || !ev.normalized) return;
      const n = ev.normalized;
      const result = await applyEvent(tx, workspaceId, n);
      await finish(
        eventId,
        result.applied ? 'processed' : 'ignored',
        n.sessionId ?? n.paymentIntent ?? n.chargeId,
        result.note,
      )(tx);
    });
  } catch (err) {
    // The tx rolled back: the event stays 'received' so the outbox retry re-applies it. Keep the reason visible.
    log.error('stripe.process_failed', { eventId, err });
    await withWorkspaceTx(workspaceId, (tx) =>
      tx.execute(
        sql`update integration_events set error = ${redactText(String((err as Error).message), 200)} where id = ${eventId}`,
      ),
    ).catch(() => undefined);
    throw err;
  }
}

async function applyEvent(
  tx: Tx,
  workspaceId: string,
  n: NormalizedStripeEvent,
): Promise<{ applied: boolean; note?: string }> {
  const pr = (
    await tx.execute<PrRow>(sql`select * from payment_requests
      where (${n.paymentRequestId}::uuid is not null and id = ${n.paymentRequestId}::uuid)
         or (${n.sessionId}::text is not null and provider_ref = ${n.sessionId})
         or (${n.paymentIntent}::text is not null and payment_intent_ref = ${n.paymentIntent})
      limit 1 for update`)
  ).rows[0];
  if (!pr) return { applied: false, note: 'unknown_payment_request' };

  const charged = Number(pr.amount_minor);
  let newStatus: PaymentStatus | null = null;
  let note: string | undefined;
  let paidNow = false;

  switch (n.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (n.paymentStatus !== 'paid' && n.type === 'checkout.session.completed') {
        // Delayed payment method: money not received yet. async_payment_* decides.
        await tx.execute(
          sql`update payment_requests set payment_intent_ref = coalesce(${n.paymentIntent}, payment_intent_ref) where id = ${pr.id}`,
        );
        return { applied: false, note: 'awaiting_async_payment' };
      }
      const ref = n.paymentIntent ?? n.sessionId!;
      const amount = n.amountMinor ?? charged;
      // Ledger first: UNIQUE (provider_ref, kind) means a replayed different event can never double-record (I2.4).
      await tx.execute(sql`insert into payments (workspace_id, payment_request_id, kind, amount_minor, currency, provider_ref, provider_event_id)
        values (${workspaceId}, ${pr.id}, 'charge', ${amount}, ${(n.currency ?? pr.currency).toUpperCase()}, ${ref}, ${n.eventId})
        on conflict (provider_ref, kind) do nothing`);
      newStatus = nextPaymentStatus(pr.status, { kind: 'paid' });
      paidNow = newStatus === 'paid';
      if (!newStatus) note = `already_${pr.status}`;
      if (newStatus) {
        await tx.execute(sql`update payment_requests set status = 'paid', paid_at = coalesce(paid_at, now()), failure_reason = null,
          payment_intent_ref = coalesce(${n.paymentIntent}, payment_intent_ref), version = version + 1 where id = ${pr.id}`);
      }
      break;
    }
    case 'checkout.session.expired':
      newStatus = nextPaymentStatus(pr.status, { kind: 'expired' });
      if (!newStatus) note = `late_expired_ignored_${pr.status}`;
      else
        await tx.execute(
          sql`update payment_requests set status = 'expired', version = version + 1 where id = ${pr.id}`,
        );
      break;
    case 'checkout.session.async_payment_failed':
    case 'payment_intent.payment_failed': {
      const reason = n.failureReason ?? 'payment_failed';
      newStatus = nextPaymentStatus(pr.status, { kind: 'failed', reason });
      if (!newStatus) note = `late_failed_ignored_${pr.status}`;
      else
        await tx.execute(sql`update payment_requests set status = 'failed', failure_reason = ${reason},
          payment_intent_ref = coalesce(${n.paymentIntent}, payment_intent_ref), version = version + 1 where id = ${pr.id}`);
      break;
    }
    case 'charge.refunded': {
      const cumulative = n.amountRefundedMinor ?? 0;
      const prior = Number(
        (
          await tx.execute<{ s: string | null }>(sql`select coalesce(sum(amount_minor), 0) as s from payments
          where payment_request_id = ${pr.id} and kind = 'refund'`)
        ).rows[0]?.s ?? 0,
      );
      const delta = cumulative - prior;
      if (delta > 0) {
        // The refund object id is not in the event (needs expansion); the cumulative amount keeps this idempotent.
        await tx.execute(sql`insert into payments (workspace_id, payment_request_id, kind, amount_minor, currency, provider_ref, provider_event_id)
          values (${workspaceId}, ${pr.id}, 'refund', ${delta}, ${(n.currency ?? pr.currency).toUpperCase()},
                  ${`${n.chargeId ?? n.paymentIntent}:${cumulative}`}, ${n.eventId})
          on conflict (provider_ref, kind) do nothing`);
      }
      newStatus = nextPaymentStatus(pr.status, {
        kind: 'refund',
        totalRefundedMinor: cumulative,
        chargedMinor: n.amountMinor ?? charged,
      });
      if (!newStatus) note = delta > 0 ? undefined : 'no_refund_delta';
      else
        await tx.execute(
          sql`update payment_requests set status = ${newStatus}, version = version + 1 where id = ${pr.id}`,
        );
      break;
    }
  }

  if (newStatus || paidNow) {
    await appendAudit(
      tx,
      { type: 'system', workspaceId },
      {
        action: `payment.${newStatus ?? 'updated'}`,
        targetType: 'payment_request',
        targetId: pr.id,
        after: { status: newStatus, event: n.eventId },
      },
    );
    await timeline(tx, workspaceId, pr, newStatus!);
    await emit(tx, { workspaceId, topic: 'payments', ids: [pr.id] });
    await emit(tx, { workspaceId, topic: 'dashboard' });
  }
  return { applied: !!newStatus, note };
}

/** Activity + "Paid ✓" thread event when those tables exist (Lane B2 / C3). Savepoint: never aborts the payment. */
async function timeline(tx: Tx, workspaceId: string, pr: PrRow, status: PaymentStatus): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      if (await tableExists(sp, 'activities')) {
        await sp.execute(sql`insert into activities (workspace_id, contact_id, opportunity_id, type, actor_type, payload, occurred_at)
          values (${workspaceId}, ${pr.contact_id}, ${pr.opportunity_id}, 'payment', 'system',
                  ${JSON.stringify({ paymentRequestId: pr.id, status })}::jsonb, now())`);
      }
      if (status === 'paid' && pr.conversation_id && (await tableExists(sp, 'messages'))) {
        await sp.execute(sql`insert into messages (workspace_id, conversation_id, direction, author_type, kind, body, template_key, status)
          values (${workspaceId}, ${pr.conversation_id}, 'out', 'system', 'event', 'Paid ✓', 'paid', 'sent')`);
        await emit(sp, { workspaceId, topic: 'messages', ids: [pr.conversation_id] });
      }
    });
  } catch (err) {
    log.warn('payments.timeline_skipped', { paymentRequestId: pr.id, err });
  }
}

/** Test/ops helper: platform-default connection row so the integrations page shows Stripe health. */
export async function ensureStripeConnectionRow(workspaceId: string): Promise<void> {
  await withWorkspaceTx(workspaceId, (tx) => ensurePlatformConnection(tx, workspaceId, 'stripe'));
}

export const paymentsService = {
  createRequest,
  cancelRequest,
  list,
  fulfillCheckout,
  processStripeEvent,
  linkMessageText,
};
