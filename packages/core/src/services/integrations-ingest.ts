// Webhook ingest pipeline (04 §2): raw body -> resolve connection -> VERIFY -> record idempotently
// (+ outbox row in the same tx) -> 200 -> process. Nothing is parsed or acted on before the signature
// is verified. Rejected forgeries are recorded (I1.2). Owner: Lane C.
import { withSystemTx, withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { decryptCreds, slackCredsFromRow } from './integrations';
import { log } from '../log';
import { redactPayload, sha256Hex } from '../integrations/redact';
import { getNotifier } from '../integrations/registry';
import type { Creds, RawRequest } from '../integrations/types';
import { enqueueJob } from '../integrations/upstream';
import { consume } from './rate-limit';

export interface IngestResult {
  status: number;
  /** Event ids that are NEW and should be processed now (after() kick). */
  newEvents: Array<{ eventId: string; workspaceId: string | null }>;
}

type ResolvedConn = {
  id: string;
  workspace_id: string;
  secrets_enc: string | null;
  public_config: Record<string, string>;
  status: string;
};

/** Run `fn` in the right tx flavour: workspace-scoped when known, else the system context. */
function scoped<T>(workspaceId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return workspaceId ? withWorkspaceTx(workspaceId, fn) : withSystemTx(fn);
}

/** Record a rejected request (forgery, replay, unknown key). Throttled per IP so it can't be used to fill the DB. */
export async function recordRejected(args: {
  workspaceId: string | null;
  connectionId: string | null;
  provider: string;
  kind: string;
  reason: string;
  rawBody: string;
  httpStatus: number;
  ip: string;
}): Promise<void> {
  try {
    const rl = await consume({
      key: `webhook-rejected:${args.provider}:${args.ip}`,
      limit: 30,
      windowSeconds: 60,
    });
    if (!rl.allowed) return;
    await scoped(args.workspaceId, (tx) =>
      tx.execute(sql`insert into integration_events
        (workspace_id, connection_id, provider, direction, kind, status, http_status, error, payload_redacted, payload_hash)
        values (${args.workspaceId}, ${args.connectionId}, ${args.provider}, 'in', ${args.kind}, 'rejected',
                ${args.httpStatus}, ${args.reason}, ${JSON.stringify({ reason: args.reason, bytes: args.rawBody.length })}::jsonb,
                ${sha256Hex(args.rawBody)})`),
    );
  } catch (err) {
    log.error('integrations.record_rejected_failed', { err });
  }
}

/** Slack: POST /api/webhooks/slack/[connectionKey]/(commands|interactions). */
export async function ingestSlack(args: {
  connectionKey: string;
  endpoint: 'commands' | 'interactions';
  req: RawRequest;
  ip: string;
  now?: Date;
}): Promise<IngestResult> {
  const { connectionKey, endpoint, req, ip } = args;
  const kind = endpoint === 'commands' ? 'slack.command' : 'slack.interaction';
  const reject = async (status: number, reason: string, ws: string | null, connId: string | null) => {
    await recordRejected({
      workspaceId: ws,
      connectionId: connId,
      provider: 'slack',
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
  let creds: Creds | null;
  if (connectionKey === 'default') {
    creds = slackCredsFromRow(null);
  } else {
    const row = await withSystemTx(
      async (tx) =>
        (
          await tx.execute<ResolvedConn>(
            sql`select * from integration_resolve_connection('slack', ${connectionKey})`,
          )
        ).rows[0],
    );
    if (!row) return reject(404, 'unknown_connection', null, null);
    workspaceId = row.workspace_id;
    connectionId = row.id;
    creds = row.secrets_enc ? decryptCreds(row) : slackCredsFromRow(null);
  }
  if (!creds) return reject(404, 'slack_not_configured', workspaceId, connectionId);

  // 2. VERIFY on the raw body, constant-time, 5 min window. Nothing else happens before this.
  const notifier = getNotifier();
  const v = notifier.verifyRequest(req, creds, args.now);
  if (!v.ok) return reject(401, v.reason, workspaceId, connectionId);

  // 3. Authentic. Parse, then (optionally) restrict to our Slack workspace.
  let normalized: Record<string, unknown>;
  let externalId: string;
  let redacted: Record<string, unknown>;
  try {
    if (endpoint === 'commands') {
      const c = notifier.parseCommand(req);
      if (creds.teamId && c.teamId !== creds.teamId)
        return reject(401, 'wrong_team', workspaceId, connectionId);
      const [sub = '', ...rest] = c.text.split(/\s+/);
      const arg = rest.join(' ');
      externalId = `cmd:${c.triggerId || sha256Hex(req.rawBody)}`;
      // The one-time link code is never stored: only its hash (matches slack_link_tokens.token_hash).
      normalized = {
        command: c.command,
        sub: sub.toLowerCase(),
        codeHash: sub.toLowerCase() === 'link' && arg ? sha256Hex(normalizeCode(arg)) : null,
        teamId: c.teamId,
        userId: c.userId,
        responseUrl: c.responseUrl,
      };
      redacted = { command: c.command, sub: sub.toLowerCase(), teamId: c.teamId, userId: c.userId };
    } else {
      const i = notifier.parseInteraction(req);
      if (creds.teamId && i.teamId && i.teamId !== creds.teamId)
        return reject(401, 'wrong_team', workspaceId, connectionId);
      externalId = `int:${i.triggerId || sha256Hex(req.rawBody)}:${i.userId}:${i.action?.actionTs ?? ''}`;
      normalized = { ...i };
      redacted = { type: i.type, actionId: i.action?.actionId ?? null, teamId: i.teamId, userId: i.userId };
    }
  } catch {
    return reject(400, 'unparseable', workspaceId, connectionId);
  }

  // 4. Record idempotently + outbox in ONE tx (no provider call here).
  const ev = await scoped(workspaceId, async (tx) => {
    const r = (
      await tx.execute<{ id: string; is_new: boolean }>(sql`select * from integration_event_ingest(
        ${workspaceId}::uuid, ${connectionId}::uuid, 'slack', ${kind}, ${externalId},
        ${JSON.stringify(redactPayload(redacted))}::jsonb, ${sha256Hex(req.rawBody)}, ${JSON.stringify(normalized)}::jsonb)`)
    ).rows[0]!;
    if (r.is_new) {
      await enqueueJob(tx, {
        type: 'integration.process',
        payload: { eventId: r.id },
        dedupeKey: `iev:${r.id}`,
      });
    }
    return r;
  });
  return { status: 200, newEvents: ev.is_new ? [{ eventId: ev.id, workspaceId }] : [] };
}

/** Codes are typed by humans: ignore case, spaces and dashes. */
export function normalizeCode(s: string): string {
  return s.replace(/[\s-]/g, '').toUpperCase();
}
