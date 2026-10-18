// WhatsApp (Meta) webhook pipeline (I1.1, I1.2, I1.8; docs/04 §2-§3): raw body -> VERIFY (constant-time HMAC)
// -> parse -> record idempotently (+ outbox in the same tx) -> 200 -> process. Nothing is parsed or acted on
// before the signature is verified. Rejected forgeries are recorded. Fails CLOSED when no app secret is configured.
import { withSystemTx, withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { config } from '../config';
import { redactPayload, sha256Hex } from '../integrations/redact';
import { getMessaging } from '../integrations/registry';
import type { Creds, ParsedMessagingEvent, RawRequest } from '../integrations/types';
import { enqueueJob } from '../integrations/upstream';
import { log } from '../log';
import { ensurePlatformConnection } from './integrations';
import { recordRejected, type IngestResult } from './integrations-ingest';
import { waCredsFromRow } from './messaging';

type ResolvedConn = {
  id: string;
  workspace_id: string;
  secrets_enc: string | null;
  public_config: Record<string, string>;
  status: string;
};

async function resolveCreds(
  connectionKey: string,
): Promise<{ creds: Creds; workspaceId: string | null; connectionId: string | null } | null> {
  if (connectionKey === 'default')
    return { creds: waCredsFromRow(null), workspaceId: null, connectionId: null };
  const row = await withSystemTx(
    async (tx) =>
      (
        await tx.execute<ResolvedConn>(
          sql`select * from integration_resolve_connection('meta_whatsapp', ${connectionKey})`,
        )
      ).rows[0],
  );
  if (!row) return null;
  return { creds: waCredsFromRow(row), workspaceId: row.workspace_id, connectionId: row.id };
}

/** GET /api/webhooks/meta/[connectionKey]: hub.challenge handshake (I1.1). */
export async function handleMetaHandshake(connectionKey: string, req: RawRequest): Promise<Response> {
  const r = await resolveCreds(connectionKey);
  if (!r) return new Response('not found', { status: 404 });
  return getMessaging().handshake(req, r.creds) ?? new Response('forbidden', { status: 403 });
}

const lastFour = (s: string) => `***${s.replace(/\D/g, '').slice(-4)}`;

/** POST /api/webhooks/meta/[connectionKey]. */
export async function ingestWhatsApp(args: {
  connectionKey: string;
  req: RawRequest;
  ip: string;
}): Promise<IngestResult> {
  const { connectionKey, req, ip } = args;
  const reject = async (status: number, reason: string, ws: string | null, connId: string | null) => {
    await recordRejected({
      workspaceId: ws,
      connectionId: connId,
      provider: 'meta_whatsapp',
      kind: 'whatsapp.webhook',
      reason,
      rawBody: req.rawBody,
      httpStatus: status,
      ip,
    });
    return { status, newEvents: [] };
  };

  // 1. Resolve credentials (routing only; authenticity comes from the signature).
  const resolved = await resolveCreds(connectionKey);
  if (!resolved) return reject(404, 'unknown_connection', null, null);
  const { creds, connectionId } = resolved;

  // 2. VERIFY on the raw body. Missing secret = refuse (503), never "accept unverified".
  if (!creds.appSecret) {
    log.error('whatsapp.webhook_refused_no_app_secret', {
      connectionKey: connectionKey === 'default' ? 'default' : '[key]',
    });
    await reject(503, 'app_secret_missing', resolved.workspaceId, connectionId);
    return { status: 503, newEvents: [] };
  }
  const messaging = getMessaging();
  const v = messaging.verifyWebhook(req, creds);
  if (!v.ok) return reject(401, v.reason, resolved.workspaceId, connectionId);

  // 3. Authentic: parse.
  let events: ParsedMessagingEvent[];
  try {
    events = messaging.parseWebhook(req);
  } catch {
    return reject(400, 'unparseable', resolved.workspaceId, connectionId);
  }
  if (!events.length) return { status: 200, newEvents: [] };

  // 4. Attribute each event to a workspace (platform number -> workspace via definer function).
  const byWs = new Map<string, ParsedMessagingEvent[]>();
  for (const e of events) {
    let ws = resolved.workspaceId;
    if (!ws) {
      ws = await withSystemTx(
        async (tx) =>
          (
            await tx.execute<{ w: string | null }>(
              sql`select messaging_resolve_workspace(${e.phoneNumberId}, ${config.whatsapp.WHATSAPP_DEFAULT_WORKSPACE_SLUG ?? null}) w`,
            )
          ).rows[0]?.w ?? null,
      );
    }
    if (!ws) {
      log.warn('whatsapp.webhook_unattributed', { type: e.type });
      continue;
    }
    byWs.set(ws, [...(byWs.get(ws) ?? []), e]);
  }

  // 5. Record idempotently + outbox in ONE tx per workspace (no provider call here).
  const bodyHash = sha256Hex(req.rawBody);
  const newEvents: IngestResult['newEvents'] = [];
  for (const [ws, evs] of byWs) {
    const out = await withWorkspaceTx(ws, async (tx) => {
      const connId = connectionId ?? (await ensurePlatformConnection(tx, ws, 'meta_whatsapp')).id;
      const created: string[] = [];
      for (const e of evs) {
        const redacted = redactPayload(
          e.type === 'inbound'
            ? { type: 'inbound', kind: e.kind, from: lastFour(e.from), hasMedia: !!e.providerMediaId }
            : { type: 'status', status: e.status, errorCode: e.errorCode ?? null },
        );
        const r = (
          await tx.execute<{ id: string; is_new: boolean }>(sql`select * from integration_event_ingest(
            ${ws}::uuid, ${connId}::uuid, 'meta_whatsapp', ${e.type === 'inbound' ? 'whatsapp.message' : 'whatsapp.status'},
            ${e.externalEventId}, ${JSON.stringify(redacted)}::jsonb, ${bodyHash}, ${JSON.stringify(e)}::jsonb)`)
        ).rows[0]!;
        if (r.is_new) {
          await enqueueJob(tx, {
            type: 'integration.process',
            payload: { eventId: r.id },
            dedupeKey: `iev:${r.id}`,
          });
          created.push(r.id);
        }
      }
      return created;
    });
    for (const eventId of out) newEvents.push({ eventId, workspaceId: ws });
  }
  return { status: 200, newEvents };
}
