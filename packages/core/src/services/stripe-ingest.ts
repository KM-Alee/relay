// Stripe webhook ingest (04 §2/§4; I2.3, I2.4): raw body -> resolve connection -> VERIFY the signature ->
// record idempotently (+ outbox row in the same tx) -> 200 -> process. Nothing is parsed or acted on before
// the signature is verified. Forgeries are recorded (rejected). Owner: Lane C (T-143).
import { withSystemTx, withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { config } from '../config';
import { log } from '../log';
import { redactPayload, sha256Hex } from '../integrations/redact';
import { getPaymentProvider } from '../integrations/registry';
import { isHandledStripeEvent, normalizeStripeEvent } from '../integrations/stripe/normalize';
import type { Creds, RawRequest } from '../integrations/types';
import { enqueueJob } from '../integrations/upstream';
import { decryptCreds } from './integrations';
import { recordRejected, type IngestResult } from './integrations-ingest';

type ResolvedConn = {
  id: string;
  workspace_id: string;
  secrets_enc: string | null;
  public_config: Record<string, string>;
};

/** Platform (env) Stripe credentials; null when the deployment has no Stripe key at all. */
export function stripeEnvCreds(): Creds {
  const s = config.stripe;
  return {
    ...(s.STRIPE_SECRET_KEY ? { secretKey: s.STRIPE_SECRET_KEY } : {}),
    ...(s.STRIPE_WEBHOOK_SECRET ? { webhookSecret: s.STRIPE_WEBHOOK_SECRET } : {}),
  };
}

/** Workspace connection credentials, falling back to the platform env for any missing field. */
export function mergeStripeCreds(
  row: Pick<ResolvedConn, 'id' | 'secrets_enc' | 'public_config'> | null,
): Creds {
  const env = stripeEnvCreds();
  if (!row?.secrets_enc) return env;
  return { ...env, ...decryptCreds(row) };
}

export async function ingestStripe(args: {
  connectionKey: string;
  req: RawRequest;
  ip: string;
}): Promise<IngestResult> {
  const { connectionKey, req, ip } = args;
  const kind = 'stripe.webhook';
  const reject = async (status: number, reason: string, ws: string | null, connId: string | null) => {
    await recordRejected({
      workspaceId: ws,
      connectionId: connId,
      provider: 'stripe',
      kind,
      reason,
      rawBody: req.rawBody,
      httpStatus: status,
      ip,
    });
    return { status, newEvents: [] };
  };

  // 1. Resolve the connection (routing only; authenticity comes from the signature).
  let workspaceId: string | null = null;
  let connectionId: string | null = null;
  let creds: Creds;
  if (connectionKey === 'default') {
    creds = stripeEnvCreds();
  } else {
    const row = await withSystemTx(
      async (tx) =>
        (
          await tx.execute<ResolvedConn>(
            sql`select * from integration_resolve_connection('stripe', ${connectionKey})`,
          )
        ).rows[0],
    );
    if (!row) return reject(404, 'unknown_connection', null, null);
    workspaceId = row.workspace_id;
    connectionId = row.id;
    creds = mergeStripeCreds(row);
  }

  // 2. VERIFY on the raw body (HMAC-SHA256, constant-time, 5 min tolerance). Nothing else happens before this.
  const v = getPaymentProvider().verifyWebhook(req, creds);
  if (!v.ok) return reject(400, v.reason, workspaceId, connectionId);

  // 3. Authentic: normalize (ids/amounts only, never card data).
  const event = v.event;
  const norm = normalizeStripeEvent(event);

  // 4. Attribute to a workspace (platform endpoint: through the signed event's own metadata).
  if (!workspaceId && norm) {
    const found = await withSystemTx(
      async (tx) =>
        (
          await tx.execute<{ workspace_id: string }>(sql`select workspace_id from payment_resolve_workspace(
            ${norm.paymentRequestId}::uuid, ${norm.sessionId}, ${norm.paymentIntent})`)
        ).rows[0],
    );
    workspaceId = found?.workspace_id ?? null;
  }

  const redacted = redactPayload(
    norm
      ? {
          type: norm.type,
          sessionId: norm.sessionId,
          paymentRequestId: norm.paymentRequestId,
          amount: norm.amountMinor,
          currency: norm.currency,
        }
      : { type: event.type },
  );
  const scoped = <T>(fn: Parameters<typeof withSystemTx<T>>[0]) =>
    workspaceId ? withWorkspaceTx(workspaceId, fn) : withSystemTx(fn);

  // 5. Record idempotently + outbox in ONE tx (no provider call here). Unhandled types / foreign events: stored as ignored.
  const process = !!norm && !!workspaceId && isHandledStripeEvent(event.type);
  const ev = await scoped(async (tx) => {
    const r = (
      await tx.execute<{ id: string; is_new: boolean }>(sql`select * from integration_event_ingest(
        ${workspaceId}::uuid, ${connectionId}::uuid, 'stripe', ${kind}, ${event.id},
        ${JSON.stringify(redacted)}::jsonb, ${sha256Hex(req.rawBody)}, ${norm ? JSON.stringify(norm) : null}::jsonb)`)
    ).rows[0]!;
    if (r.is_new) {
      if (process) {
        await enqueueJob(tx, {
          type: 'integration.process',
          payload: { eventId: r.id },
          dedupeKey: `iev:${r.id}`,
        });
      } else {
        await tx.execute(sql`update integration_events set status = 'ignored', processed_at = now(),
          reference = ${event.id}, error = ${norm ? 'unknown_payment_request' : 'unhandled_event_type'} where id = ${r.id}`);
      }
    }
    return r;
  }).catch((err: unknown) => {
    log.error('stripe.ingest_failed', { err });
    throw err;
  });
  return { status: 200, newEvents: ev.is_new && process ? [{ eventId: ev.id, workspaceId }] : [] };
}
