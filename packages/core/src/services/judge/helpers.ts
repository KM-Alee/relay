// Shared helpers for Judge Console scenarios. Owner: Lane B (T-209).
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../../auth/actor';
import { LEVEL_DEFAULTS } from '../../auth/permissions';
import { isAppError } from '../../errors';
import type { Creds } from '../../integrations/types';
import { metaSignature } from '../../integrations/meta/adapter';
import { slackSignature } from '../../integrations/slack/signature';
import { config } from '../../config';
import { ensurePlatformConnection, getWorkspaceConnection, slackCredsFromRow } from '../integrations';
import { waCredsFromRow } from '../messaging';
import { mergeStripeCreds } from '../stripe-ingest';

/** Deterministic v4-shaped uuid from a seed (stable throwaway ids, so reruns reuse rows). */
export function uuidFrom(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const nonce = (): string => randomBytes(5).toString('hex');

/** The same workspace, seen as a plain User (base level `user`, default grants, no extras). */
export function plainUser(owner: Actor): Actor {
  return {
    ...owner,
    sessionId: '',
    baseLevel: 'user',
    permissions: new Set(LEVEL_DEFAULTS.user),
  };
}

/** Run `fn`; return the AppError (code/status) it throws, or null if it did not throw. */
export async function expectError(
  fn: () => Promise<unknown>,
): Promise<
  { code: string; status: number } | { code: 'NO_ERROR'; status: 200 } | { code: 'OTHER'; status: 500 }
> {
  try {
    await fn();
    return { code: 'NO_ERROR', status: 200 };
  } catch (e) {
    return isAppError(e) ? { code: e.code, status: e.httpStatus } : { code: 'OTHER', status: 500 };
  }
}

export type SignTarget =
  { ok: true; connectionKey: string; secret: string; phoneNumberId?: string } | { ok: false; why: string };

/**
 * Resolve how to talk to a provider's webhook in THIS workspace and the signing secret the server holds
 * for it. The secret is used server-side to sign a synthetic payload and is never returned.
 */
export async function webhookTarget(
  workspaceId: string,
  provider: 'stripe' | 'meta_whatsapp' | 'slack',
): Promise<SignTarget> {
  return withWorkspaceTx(workspaceId, async (tx) => {
    let row = await getWorkspaceConnection(tx, provider);
    const platform =
      provider === 'stripe'
        ? !!config.stripe.STRIPE_WEBHOOK_SECRET
        : provider === 'meta_whatsapp'
          ? !!config.whatsapp.META_APP_SECRET
          : !!config.notifications.SLACK_SIGNING_SECRET;
    if (!row && platform) row = await ensurePlatformConnection(tx, workspaceId, provider);
    if (!row) return { ok: false as const, why: `no ${provider} connection and no platform secret` };
    let creds: Creds | null;
    if (provider === 'stripe') creds = mergeStripeCreds(row);
    else if (provider === 'meta_whatsapp') creds = waCredsFromRow(row);
    else creds = slackCredsFromRow(row);
    const secret =
      provider === 'stripe'
        ? creds?.webhookSecret
        : provider === 'meta_whatsapp'
          ? creds?.appSecret
          : creds?.signingSecret;
    if (!secret) return { ok: false as const, why: `${provider} signing secret is not configured` };
    return {
      ok: true as const,
      connectionKey: row.connection_key,
      secret,
      phoneNumberId: creds?.phoneNumberId,
    };
  });
}

export const stripeHeader = (secret: string, body: string, ts = Math.floor(Date.now() / 1000)): string =>
  `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;

export const metaHeader = metaSignature;

export function slackHeaders(secret: string, body: string, ts = Math.floor(Date.now() / 1000)): Headers {
  return new Headers({
    'x-slack-request-timestamp': String(ts),
    'x-slack-signature': slackSignature(secret, String(ts), body),
    'content-type': 'application/x-www-form-urlencoded',
  });
}

/** Mark a probe event as handled so no worker processes it (the dedupe/forgery check is what we test). */
export async function neutralizeProbe(
  workspaceId: string,
  provider: string,
  externalId: string,
): Promise<void> {
  await withWorkspaceTx(workspaceId, (tx) =>
    tx.execute(sql`update integration_events set status = 'ignored', error = 'judge_probe', processed_at = now()
      where provider = ${provider} and external_event_id = ${externalId} and status = 'received'`),
  );
}

export async function eventStats(
  workspaceId: string,
  provider: string,
  externalId: string,
): Promise<{ rows: number; duplicates: number }> {
  return withWorkspaceTx(workspaceId, async (tx) => {
    const r = (
      await tx.execute<{ n: string; d: string | null }>(sql`select count(*) n, max(duplicate_count) d
        from integration_events where provider = ${provider} and external_event_id = ${externalId}`)
    ).rows[0];
    return { rows: Number(r?.n ?? 0), duplicates: Number(r?.d ?? 0) };
  });
}

/** Rejected-request rows recorded since `since` for a provider (forgeries are logged, not processed). */
export async function rejectedSince(workspaceId: string, provider: string, since: Date): Promise<number> {
  return withWorkspaceTx(workspaceId, async (tx) => {
    const r = (
      await tx.execute<{ n: string }>(sql`select count(*) n from integration_events
        where provider = ${provider} and status = 'rejected' and created_at >= ${since.toISOString()}::timestamptz`)
    ).rows[0];
    return Number(r?.n ?? 0);
  });
}
