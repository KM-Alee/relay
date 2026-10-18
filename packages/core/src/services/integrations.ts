// Integrations service (T-140; I5.1-I5.8). Owner: Lane C.
// Connections CRUD with encrypted secrets, status/breaker bookkeeping, sync-history reads.
// Rules: `integrations.manage` / `integrations.view` checked here; secrets are encrypted at rest
// (AES-256-GCM, AAD = connection id), NEVER returned (DTOs carry hint + field names only); every change
// is audited; no provider call ever happens inside these transactions.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  PROVIDER_FIELDS,
  type BreakerHealth,
  type ConnectIntegrationInput,
  type IntegrationCardDto,
  type IntegrationConnectionDto,
  type IntegrationEventDto,
  type IntegrationProvider,
  type IntegrationsListResponse,
  INTEGRATION_PROVIDERS,
} from '@relay/contracts/api/integrations';
import { withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { config } from '../config';
import { AppError, notFound } from '../errors';
import { breakerOnFailure, breakerOnSuccess, closedBreaker, type Breaker } from '../integrations/breaker';
import { redactText } from '../integrations/redact';
import type { Creds } from '../integrations/types';
import { appendAudit } from '../integrations/upstream';
import { secrets } from '../secrets';

// Loosely-typed JSON rows from raw SQL / provider payloads (validated at the edges).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

type ConnRow = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  provider: IntegrationProvider;
  status: IntegrationConnectionDto['status'];
  connection_key: string;
  public_config: Record<string, string>;
  secrets_enc: string | null;
  secrets_hint: string | null;
  last_ok_at: Date | string | null;
  last_error_at: Date | string | null;
  last_error: string | null;
  health: { state: Breaker['state']; failures: number; opened_at: string | null };
  version: number;
};

const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());

export function newConnectionKey(): string {
  // 24 chars [a-z0-9] from 24 random bytes (~124 bits of routing entropy; not a secret).
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(24), (b) => alphabet[b % alphabet.length]).join('');
}

function toBreaker(h: ConnRow['health']): Breaker {
  return { state: h.state, failures: h.failures, openedAt: h.opened_at };
}
const breakerJson = (b: Breaker) =>
  JSON.stringify({ state: b.state, failures: b.failures, opened_at: b.openedAt });

export function toDto(r: ConnRow): IntegrationConnectionDto {
  let fieldsSet: string[] = [];
  if (r.secrets_enc) {
    try {
      fieldsSet = Object.keys(JSON.parse(secrets.decrypt(r.secrets_enc, r.id)) as object).sort();
    } catch {
      fieldsSet = []; // undecryptable (key rotated away): shown as no secrets, never an error to the browser
    }
  }
  const health: BreakerHealth = {
    state: r.health.state,
    failures: r.health.failures,
    openedAt: r.health.opened_at,
  };
  return {
    id: r.id,
    provider: r.provider,
    status: r.status,
    userId: r.user_id,
    publicConfig: r.public_config,
    secretFieldsSet: fieldsSet,
    secretsHint: r.secrets_hint,
    lastOkAt: iso(r.last_ok_at),
    lastErrorAt: iso(r.last_error_at),
    lastError: r.last_error,
    health,
    connectionKey: r.connection_key,
    version: r.version,
  };
}

// ── internal reads (also used by jobs/webhooks) ─────────────────────────
export async function getWorkspaceConnection(
  tx: Tx,
  provider: IntegrationProvider,
  forUpdate = false,
): Promise<ConnRow | null> {
  const res = await tx.execute<ConnRow>(
    forUpdate
      ? sql`select * from integration_connections where provider = ${provider} and user_id is null for update`
      : sql`select * from integration_connections where provider = ${provider} and user_id is null`,
  );
  return res.rows[0] ?? null;
}

export function decryptCreds(row: Pick<ConnRow, 'id' | 'secrets_enc' | 'public_config'>): Creds {
  const secretPart = row.secrets_enc ? (JSON.parse(secrets.decrypt(row.secrets_enc, row.id)) as Creds) : {};
  return { ...row.public_config, ...secretPart };
}

/**
 * Slack credentials for a workspace: its own connection (encrypted) if it has secrets, else the
 * platform env credentials (SLACK_*), else null. Decrypted values live only in the caller's scope.
 */
export function slackCredsFromRow(row: ConnRow | null): Creds | null {
  if (row?.secrets_enc && row.status !== 'not_connected') return decryptCreds(row);
  const n = config.notifications;
  if (n.SLACK_BOT_TOKEN && n.SLACK_SIGNING_SECRET) {
    return {
      botToken: n.SLACK_BOT_TOKEN,
      signingSecret: n.SLACK_SIGNING_SECRET,
      ...(n.SLACK_APP_ID ? { appId: n.SLACK_APP_ID } : {}),
      ...(n.SLACK_TEAM_ID ? { teamId: n.SLACK_TEAM_ID } : {}),
    };
  }
  return null;
}

/** Ensure a workspace row exists for a platform-default provider so breaker/last_ok have a home. */
export async function ensurePlatformConnection(
  tx: Tx,
  workspaceId: string,
  provider: IntegrationProvider,
): Promise<ConnRow> {
  const existing = await getWorkspaceConnection(tx, provider, true);
  if (existing) return existing;
  const id = randomUUID();
  const res = await tx.execute<ConnRow>(sql`
    insert into integration_connections (id, workspace_id, provider, status, connection_key, public_config)
    values (${id}, ${workspaceId}, ${provider}, 'connected', ${newConnectionKey()}, '{"source":"platform"}'::jsonb)
    on conflict (workspace_id, provider) where user_id is null do update set provider = excluded.provider
    returning *`);
  return res.rows[0] as ConnRow;
}

/**
 * Record the outcome of a provider call (I5.8): updates last_ok / last_error and the breaker. Runs in
 * its OWN short transaction AFTER the call, never around it.
 */
export async function recordOutcome(
  workspaceId: string,
  provider: IntegrationProvider,
  outcome: { ok: true } | { ok: false; kind: 'temporary' | 'permanent' | 'auth'; code: string },
  now: Date = new Date(),
): Promise<void> {
  await withWorkspaceTx(workspaceId, async (tx) => {
    const row = await ensurePlatformConnection(tx, workspaceId, provider);
    if (outcome.ok) {
      await tx.execute(sql`update integration_connections set last_ok_at = ${now.toISOString()}::timestamptz,
        status = case when status in ('error') then 'connected' else status end,
        health = ${breakerJson(breakerOnSuccess())}::jsonb, version = version + 1 where id = ${row.id}`);
      return;
    }
    const b =
      outcome.kind === 'temporary' ? breakerOnFailure(toBreaker(row.health), now) : toBreaker(row.health);
    const status =
      outcome.kind === 'auth' ? 'needs_reconnect' : row.status === 'connected' ? 'error' : row.status;
    await tx.execute(sql`update integration_connections set last_error_at = ${now.toISOString()}::timestamptz,
      last_error = ${redactText(outcome.code, 200)}, status = ${status}, health = ${breakerJson(b)}::jsonb,
      version = version + 1 where id = ${row.id}`);
  });
}

// ── public service API (permission-checked) ─────────────────────────────
function webhookUrls(
  provider: IntegrationProvider,
  key: string | null,
): Array<{ label: string; url: string }> {
  const base = config.core.PUBLIC_BASE_URL.replace(/\/$/, '');
  const k = key ?? 'default';
  switch (provider) {
    case 'slack':
      return [
        { label: 'commands', url: `${base}/api/webhooks/slack/${k}/commands` },
        { label: 'interactions', url: `${base}/api/webhooks/slack/${k}/interactions` },
      ];
    case 'meta_whatsapp':
    case 'stripe':
      return key ? [{ label: 'webhook', url: `${base}/api/webhooks/${provider}/${key}` }] : [];
    default:
      return [];
  }
}

const platformDefaultFor = (p: IntegrationProvider): boolean =>
  p === 'slack' && !!(config.notifications.SLACK_BOT_TOKEN && config.notifications.SLACK_SIGNING_SECRET);

function mapEventRow(r: Loose): IntegrationEventDto {
  return {
    id: r.id,
    provider: r.provider,
    direction: r.direction,
    kind: r.kind,
    status: r.status,
    duplicateCount: r.duplicate_count,
    httpStatus: r.http_status,
    latencyMs: r.latency_ms,
    reference: r.reference,
    payloadRedacted: r.payload_redacted,
    error: r.error,
    createdAt: iso(r.created_at)!,
    processedAt: iso(r.processed_at),
  };
}

async function list(actor: Actor): Promise<IntegrationsListResponse> {
  assertPermission(actor, 'integrations.view');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const conns = (
      await tx.execute<ConnRow>(sql`select * from integration_connections where user_id is null`)
    ).rows;
    const errs = (
      await tx.execute<Loose>(sql`select * from (
        select e.*, row_number() over (partition by provider order by created_at desc) rn
          from integration_events e where status in ('rejected','failed')) x where rn <= 5 order by created_at desc`)
    ).rows;
    // Visible failed deliveries (I4.4): slack alerts failed/skipped + dead/failed outbox jobs when the table exists.
    const outboxExists = (
      await tx.execute<{ t: string | null }>(sql`select to_regclass('public.outbox') as t`)
    ).rows[0]?.t;
    const dead = outboxExists
      ? Number(
          (
            await tx.execute<{ n: string }>(sql`select count(*) n from outbox
            where type like 'slack.%' and status in ('failed','dead')`)
          ).rows[0]?.n ?? 0,
        )
      : 0;
    const usersExists = (await tx.execute<{ t: string | null }>(sql`select to_regclass('public.users') as t`))
      .rows[0]?.t;
    const slackCounts = usersExists
      ? (
          await tx.execute<{
            linked: string;
            total: string;
          }>(sql`select count(*) filter (where slack_user_id is not null) linked,
          count(*) total from users where is_active`)
        ).rows[0]
      : undefined;
    const jobRuns = (await tx.execute<{ t: string | null }>(sql`select to_regclass('public.job_runs') as t`))
      .rows[0]?.t;
    const lastTick = jobRuns
      ? (await tx.execute<{ at: Date | null }>(sql`select max(started_at) at from job_runs`)).rows[0]?.at
      : null;

    const cards: IntegrationCardDto[] = INTEGRATION_PROVIDERS.map((provider) => {
      const row = conns.find((c) => c.provider === provider) ?? null;
      const f = PROVIDER_FIELDS[provider];
      const platformDefault = platformDefaultFor(provider);
      const conn = row ? toDto(row) : null;
      const status =
        conn && conn.status !== 'not_connected'
          ? conn.status
          : platformDefault
            ? 'connected'
            : 'not_connected';
      return {
        provider,
        connection: conn,
        platformDefault,
        status,
        connectable: f.connectable,
        secretFields: [...f.secret],
        publicFields: [...f.public],
        webhookUrls: webhookUrls(
          provider,
          platformDefault && !row?.secrets_enc ? null : (row?.connection_key ?? null),
        ),
        recentErrors: errs.filter((e) => e.provider === provider).map(mapEventRow),
        deadJobs: provider === 'slack' ? dead : 0,
      };
    });
    return {
      cards,
      slack: { linkedUsers: Number(slackCounts?.linked ?? 0), totalUsers: Number(slackCounts?.total ?? 0) },
      lastTickAt: iso(lastTick ?? null),
    };
  });
}

function validateConnect(provider: IntegrationProvider, input: ConnectIntegrationInput, creating: boolean) {
  const spec = PROVIDER_FIELDS[provider];
  if (!spec.connectable) {
    throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'not_connectable', provider } });
  }
  const secretKeys = Object.keys(input.secrets ?? {});
  const publicKeys = Object.keys(input.publicConfig ?? {});
  const bad = [
    ...secretKeys.filter((k) => !(spec.secret as readonly string[]).includes(k)),
    ...publicKeys.filter((k) => !(spec.public as readonly string[]).includes(k)),
  ];
  if (bad.length)
    throw new AppError('VALIDATION_FAILED', {
      details: { in: 'body', issues: bad.map((p) => ({ path: p, code: 'unrecognized_key' })) },
    });
  if (creating) {
    const missing = [
      ...spec.secret.filter((k) => !secretKeys.includes(k)),
      ...spec.requiredPublic.filter((k) => !publicKeys.includes(k)),
    ];
    // Slack may run on platform credentials, but a workspace-owned connection needs both secrets.
    if (missing.length) {
      throw new AppError('REQUIRED_FIELDS_MISSING', { details: { fields: missing } });
    }
  }
}

async function connect(
  actor: Actor,
  provider: IntegrationProvider,
  input: ConnectIntegrationInput,
): Promise<IntegrationConnectionDto> {
  assertPermission(actor, 'integrations.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const existing = await getWorkspaceConnection(tx, provider, true);
    const hadSecrets = !!existing?.secrets_enc;
    validateConnect(provider, input, !hadSecrets);
    const id = existing?.id ?? randomUUID();
    const prev: Creds = existing?.secrets_enc
      ? (JSON.parse(secrets.decrypt(existing.secrets_enc, id)) as Creds)
      : {};
    const merged: Creds = { ...prev, ...(input.secrets ?? {}) };
    const enc = secrets.encrypt(JSON.stringify(merged), id);
    const primary = PROVIDER_FIELDS[provider].secret[0];
    const hint = primary && merged[primary] ? `••••${merged[primary].slice(-4)}` : null;
    const pub = { ...(existing?.public_config ?? {}), ...(input.publicConfig ?? {}) };
    delete (pub as Record<string, unknown>).source;
    let row: ConnRow;
    if (existing) {
      const res = await tx.execute<ConnRow>(sql`update integration_connections set secrets_enc = ${enc},
        secrets_hint = ${hint}, public_config = ${JSON.stringify(pub)}::jsonb, status = 'connected',
        last_error = null, last_error_at = null, health = ${breakerJson(closedBreaker())}::jsonb,
        version = version + 1 where id = ${id} returning *`);
      row = res.rows[0] as ConnRow;
    } else {
      const res = await tx.execute<ConnRow>(sql`insert into integration_connections
        (id, workspace_id, provider, status, connection_key, public_config, secrets_enc, secrets_hint)
        values (${id}, ${actor.workspaceId}, ${provider}, 'connected', ${newConnectionKey()},
                ${JSON.stringify(pub)}::jsonb, ${enc}, ${hint}) returning *`);
      row = res.rows[0] as ConnRow;
    }
    await appendAudit(tx, actor, {
      action:
        !existing || !hadSecrets
          ? 'integration.connected'
          : Object.keys(input.secrets ?? {}).length
            ? 'integration.secret_rotated'
            : 'integration.updated',
      targetType: 'integration',
      targetId: id,
      after: { provider, secretFields: Object.keys(input.secrets ?? {}), publicConfig: pub }, // names only, never values
    });
    return toDto(row);
  });
}

async function disconnect(actor: Actor, provider: IntegrationProvider): Promise<{ ok: true }> {
  assertPermission(actor, 'integrations.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const existing = await getWorkspaceConnection(tx, provider, true);
    if (!existing) throw notFound();
    await tx.execute(sql`update integration_connections set secrets_enc = null, secrets_hint = null,
      status = 'not_connected', health = ${breakerJson(closedBreaker())}::jsonb, version = version + 1
      where id = ${existing.id}`);
    await appendAudit(tx, actor, {
      action: 'integration.disconnected',
      targetType: 'integration',
      targetId: existing.id,
      after: { provider },
    });
    return { ok: true as const };
  });
}

async function forceBreaker(
  actor: Actor,
  provider: IntegrationProvider,
  state: 'open' | 'closed',
): Promise<IntegrationConnectionDto> {
  assertPermission(actor, 'integrations.manage');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const base = platformDefaultFor(provider)
      ? await ensurePlatformConnection(tx, actor.workspaceId, provider)
      : await getWorkspaceConnection(tx, provider, true);
    if (!base) throw notFound();
    const b: Breaker =
      state === 'open' ? { state: 'open', failures: 5, openedAt: new Date().toISOString() } : closedBreaker();
    const res =
      await tx.execute<ConnRow>(sql`update integration_connections set health = ${breakerJson(b)}::jsonb,
      version = version + 1 where id = ${base.id} returning *`);
    await appendAudit(tx, actor, {
      action: 'integration.breaker_forced',
      targetType: 'integration',
      targetId: base.id,
      after: { provider, state },
    });
    return toDto(res.rows[0] as ConnRow);
  });
}

async function events(
  actor: Actor,
  q: { provider?: IntegrationProvider; status?: string; kind?: string; before?: string; limit: number },
): Promise<{ events: IntegrationEventDto[]; nextBefore: string | null }> {
  assertPermission(actor, 'integrations.view');
  return withWorkspaceTx(actor.workspaceId, async (tx) => {
    const res = await tx.execute<Loose>(sql`select * from integration_events
      where (${q.provider ?? null}::text is null or provider = ${q.provider ?? null})
        and (${q.status ?? null}::text is null or status = ${q.status ?? null})
        and (${q.kind ?? null}::text is null or kind = ${q.kind ?? null})
        and (${q.before ?? null}::timestamptz is null or created_at < ${q.before ?? null}::timestamptz)
      order by created_at desc limit ${q.limit + 1}`);
    const rows = res.rows.slice(0, q.limit);
    return {
      events: rows.map(mapEventRow),
      nextBefore: res.rows.length > q.limit ? iso(rows[rows.length - 1]!.created_at) : null,
    };
  });
}

export const integrationsService = { list, connect, disconnect, forceBreaker, events };
