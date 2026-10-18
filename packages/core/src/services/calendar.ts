// Calendar service (T-144; I3.1-I3.7). Owner: Lane C.
//  - OAuth: per-employee connect (state + PKCE in oauth_states, offline access), encrypted tokens, lazy refresh,
//    invalid_grant -> needs_reconnect, disconnect (revoke best effort + wipe).
//  - Availability: Google free/busy UNION our own scheduled appointments (covers propagation lag).
//  - Appointments: write the row + outbox `calendar.*_event` in ONE tx; the job calls Google (deterministic event id).
// Provider calls NEVER happen inside a DB transaction: read -> (tx closed) -> call -> short write tx.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  AppointmentDto,
  AvailabilityResponse,
  CalendarConnectionDto,
  CreateAppointmentInput,
  RescheduleAppointmentInput,
} from '@relay/contracts/api/calendar';
import { withWorkspaceTx, type Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../auth/actor';
import { assertPermission, can } from '../auth/permissions';
import { config } from '../config';
import {
  bookability,
  eventIdFor,
  findConflicts,
  needsRefresh,
  type CalendarStatus,
} from '../domain/calendar';
import { AppError, forbidden, notFound, staleVersion } from '../errors';
import { googleConfigured } from '../integrations/google/adapter';
import {
  breakerAllows,
  breakerOnFailure,
  breakerOnSuccess,
  closedBreaker,
  type Breaker,
} from '../integrations/breaker';
import { redactText } from '../integrations/redact';
import { getCalendarProvider } from '../integrations/registry';
import { ProviderError, type CalEvent } from '../integrations/types';
import { appendAudit, enqueueJob } from '../integrations/upstream';
import { DeferJobError } from '../jobs/policy';
import { log } from '../log';
import { emit } from '../realtime';
import { secrets } from '../secrets';
import { newConnectionKey } from './integrations';

const STATE_TTL_MS = 10 * 60_000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const b64url = (b: Buffer) => b.toString('base64url');
const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());
const tableExists = async (tx: Tx, name: string): Promise<boolean> =>
  !!(await tx.execute<{ t: string | null }>(sql`select to_regclass(${`public.${name}`}) as t`)).rows[0]?.t;

export function redirectUri(): string {
  return (
    config.google.GOOGLE_REDIRECT_URI ??
    `${config.core.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/integrations/google/callback`
  );
}

// ── connection rows ─────────────────────────────────────────────────────
type ConnRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  status: CalendarStatus;
  public_config: Record<string, string>;
  secrets_enc: string | null;
  last_ok_at: Date | string | null;
  last_error: string | null;
  health: { state: Breaker['state']; failures: number; opened_at: string | null };
  version: number;
};
type TokenBag = { refreshToken: string; accessToken?: string; accessExpiresAt?: string };

const getUserConn = async (tx: Tx, userId: string, forUpdate = false): Promise<ConnRow | null> =>
  (
    await tx.execute<ConnRow>(
      forUpdate
        ? sql`select * from integration_connections where provider = 'google_calendar' and user_id = ${userId} for update`
        : sql`select * from integration_connections where provider = 'google_calendar' and user_id = ${userId}`,
    )
  ).rows[0] ?? null;

const readTokens = (c: ConnRow): TokenBag | null =>
  c.secrets_enc ? (JSON.parse(secrets.decrypt(c.secrets_enc, c.id)) as TokenBag) : null;
const breakerOf = (h: ConnRow['health']): Breaker => ({
  state: h.state,
  failures: h.failures,
  openedAt: h.opened_at,
});
const breakerJson = (b: Breaker) =>
  JSON.stringify({ state: b.state, failures: b.failures, opened_at: b.openedAt });

// ── OAuth connect / disconnect (I3.1) ───────────────────────────────────
/** Builds the Google consent URL and stores state + PKCE verifier (encrypted, single use, 10 min). */
export async function startConnect(actor: Actor, now: Date = new Date()): Promise<string> {
  if (!googleConfigured())
    throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'google_not_configured' } });
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(48));
  const stateHash = sha256(state);
  await withWorkspaceTx(actor.workspaceId, async (tx) => {
    await tx.execute(sql`insert into oauth_states (state_hash, workspace_id, user_id, code_verifier_enc, expires_at)
      values (${stateHash}, ${actor.workspaceId}, ${actor.userId}, ${secrets.encrypt(verifier, stateHash)},
              ${new Date(now.getTime() + STATE_TTL_MS).toISOString()}::timestamptz)`);
  });
  return getCalendarProvider().authUrl({
    state,
    codeChallenge: b64url(createHash('sha256').update(verifier).digest()),
    redirectUri: redirectUri(),
  });
}

/** OAuth callback: validate state (single use, same user), exchange the code, encrypt + store the tokens. */
export async function completeConnect(
  actor: Actor,
  q: { code?: string; state?: string; error?: string },
  now: Date = new Date(),
): Promise<{ ok: true; email: string | null }> {
  if (q.error || !q.code || !q.state) {
    throw new AppError('BUSINESS_RULE_VIOLATION', {
      details: { reason: q.error ? 'consent_denied' : 'missing_code' },
    });
  }
  const stateHash = sha256(q.state);
  const claimed = await withWorkspaceTx(
    actor.workspaceId,
    async (tx) =>
      (
        await tx.execute<{
          code_verifier_enc: string;
        }>(sql`update oauth_states set used_at = ${now.toISOString()}::timestamptz
        where state_hash = ${stateHash} and user_id = ${actor.userId} and used_at is null
          and expires_at > ${now.toISOString()}::timestamptz
        returning code_verifier_enc`)
      ).rows[0],
  );
  if (!claimed) throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'invalid_state' } });
  const verifier = secrets.decrypt(claimed.code_verifier_enc, stateHash);

  const tokens = await getCalendarProvider().exchangeCode({
    code: q.code,
    codeVerifier: verifier,
    redirectUri: redirectUri(),
  });

  await withWorkspaceTx(actor.workspaceId, async (tx) => {
    const existing = await getUserConn(tx, actor.userId, true);
    const prev = existing ? readTokens(existing) : null;
    const refreshToken = tokens.refreshToken ?? prev?.refreshToken;
    if (!refreshToken) {
      throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'no_refresh_token' } });
    }
    const id = existing?.id ?? randomUUID();
    const bag: TokenBag = {
      refreshToken,
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.expiresAt.toISOString(),
    };
    const enc = secrets.encrypt(JSON.stringify(bag), id);
    const pub = JSON.stringify({
      email: tokens.email ?? existing?.public_config.email ?? '',
      calendarId: 'primary',
    });
    if (existing) {
      await tx.execute(sql`update integration_connections set secrets_enc = ${enc}, secrets_hint = ${`••••${refreshToken.slice(-4)}`},
        public_config = ${pub}::jsonb, status = 'connected', last_error = null, last_error_at = null, last_ok_at = ${now.toISOString()}::timestamptz,
        health = ${breakerJson(closedBreaker())}::jsonb, version = version + 1 where id = ${id}`);
    } else {
      await tx.execute(sql`insert into integration_connections
        (id, workspace_id, user_id, provider, status, connection_key, public_config, secrets_enc, secrets_hint, last_ok_at)
        values (${id}, ${actor.workspaceId}, ${actor.userId}, 'google_calendar', 'connected', ${newConnectionKey()}, ${pub}::jsonb,
                ${enc}, ${`••••${refreshToken.slice(-4)}`}, ${now.toISOString()}::timestamptz)`);
    }
    await appendAudit(tx, actor, {
      action: 'integration.connected',
      targetType: 'integration',
      targetId: id,
      after: { provider: 'google_calendar', userId: actor.userId }, // names only, never tokens
    });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'integrations' });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'appointments' });
  });
  return { ok: true, email: tokens.email ?? null };
}

export async function disconnect(actor: Actor): Promise<{ ok: true }> {
  const conn = await withWorkspaceTx(actor.workspaceId, (tx) => getUserConn(tx, actor.userId));
  if (!conn) return { ok: true };
  // Best-effort revoke at Google, outside any transaction.
  const refreshToken = conn.secrets_enc ? readTokens(conn)?.refreshToken : undefined;
  if (refreshToken) {
    try {
      await getCalendarProvider().revoke(refreshToken);
    } catch (err) {
      log.warn('calendar.revoke_failed', { err });
    }
  }
  await withWorkspaceTx(actor.workspaceId, async (tx) => {
    await tx.execute(sql`update integration_connections set secrets_enc = null, secrets_hint = null, status = 'not_connected',
      last_error = null, health = ${breakerJson(closedBreaker())}::jsonb, version = version + 1 where id = ${conn.id}`);
    await appendAudit(tx, actor, {
      action: 'integration.disconnected',
      targetType: 'integration',
      targetId: conn.id,
      after: { provider: 'google_calendar' },
    });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'integrations' });
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'appointments' });
  });
  return { ok: true };
}

export async function connectionStatus(actor: Actor): Promise<CalendarConnectionDto> {
  const c = await withWorkspaceTx(actor.workspaceId, (tx) => getUserConn(tx, actor.userId));
  return {
    status: c?.status ?? 'not_connected',
    email: c?.status && c.status !== 'not_connected' ? c.public_config.email || null : null,
    lastOkAt: iso(c?.last_ok_at ?? null),
    lastError: c?.last_error ?? null,
    available: googleConfigured() || !!config.testing.INTEGRATIONS_FAKE,
  };
}

/** I3.7: every active employee's calendar status + bookability reason. Emails only for integrations.view. */
export async function team(actor: Actor) {
  if (!can(actor, 'appointments.manage') && !can(actor, 'integrations.view'))
    throw forbidden({ permission: 'appointments.manage' });
  const showEmail = can(actor, 'integrations.view');
  const rows = await withWorkspaceTx(
    actor.workspaceId,
    async (tx) =>
      (
        await tx.execute<{
          id: string;
          name: string;
          status: CalendarStatus | null;
          email: string | null;
        }>(sql`
          select u.id, u.name, c.status, c.public_config->>'email' as email
            from users u left join integration_connections c
              on c.user_id = u.id and c.provider = 'google_calendar' and c.workspace_id = u.workspace_id
           where u.is_active order by u.name`)
      ).rows,
  );
  return {
    members: rows.map((r) => {
      const b = bookability(r.status);
      return {
        userId: r.id,
        name: r.name,
        status: (r.status ?? 'not_connected') as CalendarStatus,
        email: showEmail && r.status === 'connected' ? r.email || null : null,
        bookable: b.bookable,
        reason: b.reason,
      };
    }),
  };
}

// ── tokens (I3.2) ───────────────────────────────────────────────────────
/**
 * A valid access token for `userId`: cached one if not near expiry, else refresh (outside any tx) and store.
 * invalid_grant -> status needs_reconnect (+ realtime hint), then the ProviderError('auth') propagates.
 */
export async function accessTokenFor(
  workspaceId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; connectionId: string }> {
  const conn = await withWorkspaceTx(workspaceId, (tx) => getUserConn(tx, userId));
  if (!conn || conn.status === 'not_connected' || !conn.secrets_enc) {
    throw new ProviderError('auth', 'no_calendar_connected', 'No calendar connected');
  }
  if (conn.status === 'needs_reconnect')
    throw new ProviderError('auth', 'needs_reconnect', 'Calendar needs to be reconnected');
  const gate = breakerAllows(breakerOf(conn.health), now);
  if (!gate.allow) throw new DeferJobError(gate.retryInMs, 'google breaker open');
  const bag = readTokens(conn)!;
  const exp = bag.accessExpiresAt ? new Date(bag.accessExpiresAt) : null;
  if (bag.accessToken && !needsRefresh(exp, now)) return { token: bag.accessToken, connectionId: conn.id };

  try {
    const t = await getCalendarProvider().refresh(bag.refreshToken);
    const next: TokenBag = {
      refreshToken: t.refreshToken ?? bag.refreshToken,
      accessToken: t.accessToken,
      accessExpiresAt: t.expiresAt.toISOString(),
    };
    await withWorkspaceTx(workspaceId, (tx) =>
      tx.execute(sql`update integration_connections set secrets_enc = ${secrets.encrypt(JSON.stringify(next), conn.id)},
        last_ok_at = ${now.toISOString()}::timestamptz, last_error = null, health = ${breakerJson(breakerOnSuccess())}::jsonb
        where id = ${conn.id}`),
    );
    return { token: t.accessToken, connectionId: conn.id };
  } catch (err) {
    const pe =
      err instanceof ProviderError
        ? err
        : new ProviderError('temporary', 'google_refresh_failed', String((err as Error).message));
    await recordConnFailure(workspaceId, conn, pe, now);
    throw pe;
  }
}

async function recordConnFailure(
  workspaceId: string,
  conn: ConnRow,
  pe: ProviderError,
  now: Date,
): Promise<void> {
  await withWorkspaceTx(workspaceId, async (tx) => {
    const b =
      pe.kind === 'temporary' ? breakerOnFailure(breakerOf(conn.health), now) : breakerOf(conn.health);
    const status =
      pe.kind === 'auth' ? 'needs_reconnect' : conn.status === 'connected' ? 'error' : conn.status;
    await tx.execute(sql`update integration_connections set status = ${status}, last_error = ${redactText(pe.code, 200)},
      last_error_at = ${now.toISOString()}::timestamptz, health = ${breakerJson(b)}::jsonb, version = version + 1 where id = ${conn.id}`);
    if (pe.kind === 'auth') {
      await appendAudit(
        tx,
        { type: 'system', workspaceId },
        {
          action: 'integration.needs_reconnect',
          targetType: 'integration',
          targetId: conn.id,
          after: { provider: 'google_calendar', code: pe.code },
        },
      );
      await emit(tx, { workspaceId, topic: 'integrations' });
      await emit(tx, { workspaceId, topic: 'appointments' });
    }
  });
}

// ── availability (I3.4) ─────────────────────────────────────────────────
type ApptRow = {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  user_id: string;
  provider_event_id: string | null;
  html_link: string | null;
  title: string;
  notes: string | null;
  attendee_email: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  timezone: string;
  status: 'scheduled' | 'cancelled';
  sync_status: 'pending' | 'synced' | 'failed';
  created_by: string | null;
  version: number;
};

const toAppt = (r: ApptRow): AppointmentDto => ({
  id: r.id,
  userId: r.user_id,
  contactId: r.contact_id,
  opportunityId: r.opportunity_id,
  leadId: r.lead_id,
  title: r.title,
  notes: r.notes,
  startsAt: iso(r.starts_at)!,
  endsAt: iso(r.ends_at)!,
  timezone: r.timezone,
  status: r.status,
  syncStatus: r.sync_status,
  htmlLink: r.html_link,
  version: r.version,
});

async function localBusy(
  tx: Tx,
  userId: string,
  from: Date,
  to: Date,
  excludeId?: string,
): Promise<Array<{ start: Date; end: Date; source: 'relay' }>> {
  const rows = (
    await tx.execute<{ starts_at: Date; ends_at: Date }>(sql`select starts_at, ends_at from appointments
      where user_id = ${userId} and status = 'scheduled' and starts_at < ${to.toISOString()}::timestamptz
        and ends_at > ${from.toISOString()}::timestamptz ${excludeId ? sql`and id <> ${excludeId}` : sql``}`)
  ).rows;
  return rows.map((r) => ({
    start: new Date(r.starts_at),
    end: new Date(r.ends_at),
    source: 'relay' as const,
  }));
}

/** Google busy blocks for a user; `null` when Google cannot be reached (caller degrades to local-only). */
async function googleBusy(workspaceId: string, userId: string, from: Date, to: Date, now: Date) {
  try {
    const { token, connectionId } = await accessTokenFor(workspaceId, userId, now);
    const busy = await getCalendarProvider().freeBusy(token, from, to);
    await withWorkspaceTx(workspaceId, (tx) =>
      tx.execute(
        sql`update integration_connections set last_ok_at = ${now.toISOString()}::timestamptz where id = ${connectionId}`,
      ),
    ).catch(() => undefined);
    return busy.map((b) => ({ ...b, source: 'google' as const }));
  } catch (err) {
    log.warn('calendar.freebusy_unavailable', { userId, err });
    return null;
  }
}

export async function availability(
  actor: Actor,
  userId: string,
  from: Date,
  to: Date,
  now: Date = new Date(),
): Promise<AvailabilityResponse> {
  assertPermission(actor, 'appointments.manage');
  const status = await withWorkspaceTx(actor.workspaceId, async (tx) => {
    const u = (await tx.execute<{ id: string }>(sql`select id from users where id = ${userId} and is_active`))
      .rows[0];
    if (!u) throw notFound();
    return (await getUserConn(tx, userId))?.status ?? null;
  });
  const b = bookability(status);
  const local = await withWorkspaceTx(actor.workspaceId, (tx) => localBusy(tx, userId, from, to));
  if (!b.bookable) {
    return { userId, bookable: false, reason: b.reason, partial: false, busy: local.map(blockDto) };
  }
  const g = await googleBusy(actor.workspaceId, userId, from, to, now);
  return {
    userId,
    bookable: true,
    reason: null,
    partial: g === null,
    busy: [...(g ?? []), ...local].map(blockDto),
  };
}

const blockDto = (b: { start: Date; end: Date; source: 'google' | 'relay' }) => ({
  start: b.start.toISOString(),
  end: b.end.toISOString(),
  source: b.source,
});

// ── appointments (I3.3, I3.5, I3.6) ─────────────────────────────────────
const canSeeAll = (a: Actor) => a.baseLevel !== 'user' || can(a, 'leads.view_all');

function scopeOr404(a: Actor, r: ApptRow | undefined): ApptRow {
  if (!r) throw notFound();
  if (!canSeeAll(a) && r.user_id !== a.userId && r.created_by !== a.userId) throw notFound();
  return r;
}

async function assertNoConflict(
  tx: Tx,
  actor: Actor,
  userId: string,
  slot: { start: Date; end: Date },
  gBusy: Array<{ start: Date; end: Date }> | null,
  override: boolean | undefined,
  excludeId?: string,
) {
  // Serialize concurrent bookings of the same calendar (transaction-level lock: safe on the Neon pooler).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`appt:${userId}`}))`);
  const local = await localBusy(tx, userId, slot.start, slot.end, excludeId);
  const conflicts = findConflicts(slot, [...(gBusy ?? []), ...local]);
  if (conflicts.length === 0) return;
  if (!override) {
    throw new AppError('CONFLICT', {
      details: {
        reason: 'calendar_conflict',
        canOverride: can(actor, 'appointments.override'),
        conflicts: conflicts.length,
      },
    });
  }
  if (!can(actor, 'appointments.override')) throw forbidden({ permission: 'appointments.override' });
}

export async function createAppointment(
  actor: Actor,
  input: CreateAppointmentInput,
  now: Date = new Date(),
): Promise<AppointmentDto> {
  assertPermission(actor, 'appointments.manage');
  const userId = input.userId ?? actor.userId;
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (!(end > start))
    throw new AppError('VALIDATION_FAILED', {
      details: { in: 'body', issues: [{ path: 'endsAt', code: 'ends_before_start' }] },
    });

  // I3.7: the booked employee must have a connected calendar; the reason is explicit.
  const status = await withWorkspaceTx(actor.workspaceId, async (tx) => {
    const u = (await tx.execute<{ id: string }>(sql`select id from users where id = ${userId} and is_active`))
      .rows[0];
    if (!u) throw notFound();
    return (await getUserConn(tx, userId))?.status ?? null;
  });
  const b = bookability(status);
  if (!b.bookable) throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: b.reason, userId } });

  // Free/busy BEFORE the write tx (provider call outside any transaction). Google down -> local check only.
  const gBusy = await googleBusy(actor.workspaceId, userId, start, end, now);

  const row = await withWorkspaceTx(actor.workspaceId, async (tx) => {
    await assertNoConflict(tx, actor, userId, { start, end }, gBusy, input.override);
    const conn = await getUserConn(tx, userId);
    const ins = (
      await tx.execute<ApptRow>(sql`insert into appointments
        (workspace_id, contact_id, opportunity_id, lead_id, user_id, connection_id, title, notes, attendee_email,
         starts_at, ends_at, timezone, created_by)
        values (${actor.workspaceId}, ${input.contactId ?? null}, ${input.opportunityId ?? null}, ${input.leadId ?? null},
                ${userId}, ${conn?.id ?? null}, ${input.title}, ${input.notes ?? null}, ${input.attendeeEmail ?? null},
                ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, ${input.timezone}, ${actor.userId})
        returning *`)
    ).rows[0]!;
    await enqueueJob(tx, {
      type: 'calendar.create_event',
      payload: { appointmentId: ins.id, version: ins.version },
      dedupeKey: `cal:create:${ins.id}:${ins.version}`,
    });
    if (ins.contact_id) {
      // I3.9: localized WhatsApp confirmation (skipped later when the contact has no phone / opted out).
      await enqueueJob(tx, {
        type: 'appointment.confirm',
        payload: { appointmentId: ins.id },
        dedupeKey: `appt:confirm:${ins.id}:${ins.version}`,
        maxAttempts: 4,
      });
    }
    await appendAudit(tx, actor, {
      action: 'appointment.created',
      targetType: 'appointment',
      targetId: ins.id,
      after: { userId, startsAt: ins.starts_at, timezone: input.timezone },
    });
    await activity(tx, actor.workspaceId, ins, 'created', actor.userId);
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'appointments', ids: [ins.id] });
    return ins;
  });
  return toAppt(row);
}

export async function rescheduleAppointment(
  actor: Actor,
  id: string,
  input: RescheduleAppointmentInput,
  now: Date = new Date(),
): Promise<AppointmentDto> {
  assertPermission(actor, 'appointments.manage');
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (!(end > start))
    throw new AppError('VALIDATION_FAILED', {
      details: { in: 'body', issues: [{ path: 'endsAt', code: 'ends_before_start' }] },
    });
  const cur = await withWorkspaceTx(actor.workspaceId, async (tx) =>
    scopeOr404(actor, (await tx.execute<ApptRow>(sql`select * from appointments where id = ${id}`)).rows[0]),
  );
  if (cur.status !== 'scheduled')
    throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'appointment_cancelled' } });
  const gBusy = await googleBusy(actor.workspaceId, cur.user_id, start, end, now);

  const row = await withWorkspaceTx(actor.workspaceId, async (tx) => {
    await assertNoConflict(tx, actor, cur.user_id, { start, end }, gBusy, input.override, id);
    const upd = (
      await tx.execute<ApptRow>(sql`update appointments set starts_at = ${start.toISOString()}::timestamptz,
        ends_at = ${end.toISOString()}::timestamptz, timezone = ${input.timezone}, title = ${input.title ?? cur.title},
        sync_status = 'pending', sync_error = null, version = version + 1
        where id = ${id} and version = ${input.version} and status = 'scheduled' returning *`)
    ).rows[0];
    if (!upd) throw staleVersion();
    await enqueueJob(tx, {
      type: 'calendar.update_event',
      payload: { appointmentId: id, version: upd.version },
      dedupeKey: `cal:update:${id}:${upd.version}`,
    });
    await appendAudit(tx, actor, {
      action: 'appointment.rescheduled',
      targetType: 'appointment',
      targetId: id,
      before: { startsAt: iso(cur.starts_at) },
      after: { startsAt: iso(upd.starts_at), timezone: upd.timezone },
    });
    await activity(tx, actor.workspaceId, upd, 'rescheduled', actor.userId);
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'appointments', ids: [id] });
    return upd;
  });
  return toAppt(row);
}

export async function cancelAppointment(actor: Actor, id: string, version: number): Promise<AppointmentDto> {
  assertPermission(actor, 'appointments.manage');
  const row = await withWorkspaceTx(actor.workspaceId, async (tx) => {
    const cur = scopeOr404(
      actor,
      (await tx.execute<ApptRow>(sql`select * from appointments where id = ${id} for update`)).rows[0],
    );
    if (cur.status === 'cancelled') return cur; // idempotent
    const upd = (
      await tx.execute<ApptRow>(sql`update appointments set status = 'cancelled', sync_status = 'pending', sync_error = null, version = version + 1
        where id = ${id} and version = ${version} returning *`)
    ).rows[0];
    if (!upd) throw staleVersion();
    await enqueueJob(tx, {
      type: 'calendar.cancel_event',
      payload: { appointmentId: id, version: upd.version },
      dedupeKey: `cal:cancel:${id}:${upd.version}`,
    });
    await appendAudit(tx, actor, {
      action: 'appointment.cancelled',
      targetType: 'appointment',
      targetId: id,
    });
    await activity(tx, actor.workspaceId, upd, 'cancelled', actor.userId);
    await emit(tx, { workspaceId: actor.workspaceId, topic: 'appointments', ids: [id] });
    return upd;
  });
  return toAppt(row);
}

export async function listAppointments(
  actor: Actor,
  q: { from?: string; to?: string; userId?: string; contactId?: string; opportunityId?: string },
): Promise<{ appointments: AppointmentDto[] }> {
  assertPermission(actor, 'appointments.manage');
  const all = canSeeAll(actor);
  const rows = await withWorkspaceTx(
    actor.workspaceId,
    async (tx) =>
      (
        await tx.execute<ApptRow>(sql`select * from appointments where true
          ${q.from ? sql`and ends_at >= ${q.from}::timestamptz` : sql``}
          ${q.to ? sql`and starts_at < ${q.to}::timestamptz` : sql``}
          ${q.userId ? sql`and user_id = ${q.userId}` : sql``}
          ${q.contactId ? sql`and contact_id = ${q.contactId}` : sql``}
          ${q.opportunityId ? sql`and opportunity_id = ${q.opportunityId}` : sql``}
          ${all ? sql`` : sql`and (user_id = ${actor.userId} or created_by = ${actor.userId})`}
          order by starts_at limit 500`)
      ).rows,
  );
  return { appointments: rows.map(toAppt) };
}

/** Customer-record timeline entry when the activities table exists (Lane B2). Savepoint: never aborts the booking. */
async function activity(
  tx: Tx,
  workspaceId: string,
  a: ApptRow,
  what: string,
  actorUserId: string,
): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      if (!(await tableExists(sp, 'activities'))) return;
      await sp.execute(sql`insert into activities (id, workspace_id, contact_id, opportunity_id, lead_id, type, actor_type, actor_user_id, payload, occurred_at)
        values (gen_random_uuid(), ${workspaceId}, ${a.contact_id}, ${a.opportunity_id}, ${a.lead_id}, 'appointment', 'user', ${actorUserId},
                ${JSON.stringify({ appointmentId: a.id, what, title: a.title, startsAt: iso(a.starts_at), timezone: a.timezone })}::jsonb, now())`);
    });
  } catch (err) {
    log.warn('calendar.activity_skipped', { appointmentId: a.id, err });
  }
}

// ── outbox sync: calendar.create_event / update_event / cancel_event ────
export type SyncOp = 'create' | 'update' | 'cancel';

/** Idempotent: re-reads the appointment and drives Google to its CURRENT state (deterministic event id). */
export async function syncAppointment(
  workspaceId: string,
  appointmentId: string,
  op: SyncOp,
  now: Date = new Date(),
): Promise<void> {
  const a = (
    await withWorkspaceTx(workspaceId, (tx) =>
      tx.execute<ApptRow>(sql`select * from appointments where id = ${appointmentId}`),
    )
  ).rows[0];
  if (!a) return;
  const wantCancel = op === 'cancel' || a.status === 'cancelled';
  if (wantCancel && !a.provider_event_id) {
    await markSync(workspaceId, a.id, { status: 'synced' }); // never reached Google: nothing to remove
    return;
  }
  const failSync = async (err: unknown) => {
    const pe = err instanceof ProviderError ? err : null;
    if (pe && pe.kind !== 'temporary')
      await markSync(workspaceId, a.id, { status: 'failed', error: pe.code });
  };
  try {
    const { token, connectionId } = await accessTokenFor(workspaceId, a.user_id, now);
    const g = getCalendarProvider();
    if (wantCancel) {
      await g.cancelEvent(token, a.provider_event_id!);
      await markSync(workspaceId, a.id, { status: 'synced' });
      return;
    }
    const ev: CalEvent = {
      eventId: eventIdFor(a.id),
      title: a.title,
      ...(a.notes ? { description: a.notes } : {}),
      start: new Date(a.starts_at),
      end: new Date(a.ends_at),
      timeZone: a.timezone,
      ...(a.attendee_email ? { attendeeEmail: a.attendee_email } : {}),
    };
    let link: string;
    let eventId: string;
    if (op === 'update' && a.provider_event_id) {
      link = (await g.updateEvent(token, a.provider_event_id, ev)).htmlLink;
      eventId = a.provider_event_id;
    } else {
      const created = await g.createEvent(token, ev);
      link = created.htmlLink;
      eventId = created.providerEventId;
    }
    await markSync(workspaceId, a.id, {
      status: 'synced',
      providerEventId: eventId,
      htmlLink: link,
      connectionId,
    });
  } catch (err) {
    await failSync(err);
    throw err; // the runner maps kind -> retry / failed / needs_reconnect
  }
}

async function markSync(
  workspaceId: string,
  id: string,
  o: {
    status: 'synced' | 'failed';
    error?: string;
    providerEventId?: string;
    htmlLink?: string;
    connectionId?: string;
  },
) {
  await withWorkspaceTx(workspaceId, async (tx) => {
    await tx.execute(sql`update appointments set sync_status = ${o.status}, sync_error = ${o.error ?? null},
      provider_event_id = coalesce(${o.providerEventId ?? null}, provider_event_id),
      html_link = coalesce(${o.htmlLink ?? null}, html_link),
      connection_id = coalesce(${o.connectionId ?? null}::uuid, connection_id) where id = ${id}`);
    await emit(tx, { workspaceId, topic: 'appointments', ids: [id] });
  });
}

export const calendarService = {
  startConnect,
  completeConnect,
  disconnect,
  connectionStatus,
  team,
  availability,
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
  listAppointments,
  syncAppointment,
};
