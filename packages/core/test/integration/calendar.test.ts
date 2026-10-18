// [I3.1][I3.2][I3.3][I3.4][I3.6][I3.7] Google Calendar on real Postgres as app_user (T-144). Fake Google adapter.
import { randomUUID } from 'node:crypto';
import { closeDb, withWorkspaceTx } from '@relay/db';
import { workspaces } from '@relay/db/schema';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwner } from '../../../db/test/helpers';
import type { Actor } from '../../src/auth/actor';
import { createFakeGoogle } from '../../src/integrations/google/fake';
import { setCalendarProvider } from '../../src/integrations/registry';
import { ProviderError } from '../../src/integrations/types';
import {
  accessTokenFor,
  availability,
  cancelAppointment,
  completeConnect,
  createAppointment,
  rescheduleAppointment,
  startConnect,
  syncAppointment,
  team,
} from '../../src/services/calendar';

const ws = randomUUID();
const uid = randomUUID();
const bare = randomUUID(); // an employee with no calendar
const fake = createFakeGoogle();
const owner: Actor = {
  userId: uid,
  workspaceId: ws,
  sessionId: randomUUID(),
  baseLevel: 'owner',
  permissions: new Set(),
  locale: 'en',
};
const plain: Actor = { ...owner, baseLevel: 'user', permissions: new Set(['appointments.manage']) };
let ready = false;

const at = (h: number, m = 0) => new Date(Date.UTC(2031, 0, 14, h, m)).toISOString();
const slot = (h: number, dur = 30) => ({ startsAt: at(h), endsAt: at(h, dur), timezone: 'Asia/Karachi' });

beforeAll(async () => {
  const have = await withOwner(async (c) => {
    const r = await c.query(
      `select to_regclass('public.users') u, to_regclass('public.audit_events') a, to_regclass('public.outbox') o`,
    );
    return Object.values(r.rows[0]).every(Boolean);
  });
  if (!have) return console.warn('[calendar.test] SKIPPED: users/audit_events/outbox tables missing');
  ready = true;
  setCalendarProvider(fake);
  await withWorkspaceTx(ws, async (tx) => {
    await tx.insert(workspaces).values({ id: ws, name: 'Cal WS', slug: `cal-${ws}` });
    for (const [id, name] of [
      [uid, 'Ayesha'],
      [bare, 'Bilal'],
    ] as const)
      await tx.execute(sql`insert into users (id, workspace_id, email, name, password_hash, base_level)
        values (${id}, ${ws}, ${`u-${id}@example.com`}, ${name}, 'x', 'owner')`);
  });
});
afterAll(async () => {
  setCalendarProvider(null);
  await closeDb();
});

const rowOf = async (id: string) =>
  (
    await withWorkspaceTx(ws, (tx) =>
      tx.execute<Record<string, string>>(sql`select * from appointments where id = ${id}`),
    )
  ).rows[0]!;

describe('[I3.1] OAuth connect', () => {
  it('[I3.1][I3.2] state is single-use; tokens are stored encrypted; an unconnected employee is not bookable (I3.7)', async (ctx) => {
    if (!ready) return ctx.skip();
    const url = new URL(await startConnect(owner));
    const state = url.searchParams.get('state')!;
    await expect(completeConnect(owner, { code: 'abc', state: 'forged' })).rejects.toMatchObject({
      details: { reason: 'invalid_state' },
    });
    await expect(
      completeConnect({ ...plain, userId: randomUUID() }, { code: 'abc', state }),
    ).rejects.toMatchObject({ details: { reason: 'invalid_state' } }); // wrong user -> not claimed
    await completeConnect(owner, { code: 'abc', state });
    await expect(completeConnect(owner, { code: 'abc', state })).rejects.toMatchObject({
      details: { reason: 'invalid_state' },
    }); // replay
    const row = await withOwner((c) =>
      c.query(`select secrets_enc, status from integration_connections where user_id = $1`, [uid]),
    );
    expect(row.rows[0].status).toBe('connected');
    expect(row.rows[0].secrets_enc).toMatch(/^v1\./);
    expect(row.rows[0].secrets_enc).not.toContain('ya29');
    const members = (await team(owner)).members;
    expect(members.find((m) => m.userId === uid)).toMatchObject({ bookable: true, reason: null });
    expect(members.find((m) => m.userId === bare)).toMatchObject({
      bookable: false,
      reason: 'no_calendar_connected',
    });
    await expect(createAppointment(owner, { userId: bare, title: 'x', ...slot(8) })).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      details: { reason: 'no_calendar_connected' },
    });
  });
});

describe('[I3.3][I3.4][I3.6] appointments', () => {
  let apptId = '';
  let version = 0;

  it('[I3.4] a Google-busy slot conflicts; override needs appointments.override', async (ctx) => {
    if (!ready) return ctx.skip();
    fake.busy = [{ start: new Date(at(9)), end: new Date(at(10)) }];
    const av = await availability(owner, uid, new Date(at(0)), new Date(at(23)));
    expect(av.busy.some((b) => b.source === 'google')).toBe(true);
    await expect(createAppointment(owner, { title: 'Visit', ...slot(9) })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(
      createAppointment(plain, { title: 'Visit', ...slot(9), override: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('[I3.3][I3.5] books (UTC + IANA), enqueues the Google event; the job creates it with a deterministic id; retry does not duplicate', async (ctx) => {
    if (!ready) return ctx.skip();
    fake.busy = [];
    const a = await createAppointment(owner, { title: 'Site visit', ...slot(11) });
    apptId = a.id;
    version = a.version;
    expect(a).toMatchObject({
      timezone: 'Asia/Karachi',
      startsAt: at(11),
      syncStatus: 'pending',
      status: 'scheduled',
    });
    await syncAppointment(ws, a.id, 'create');
    await syncAppointment(ws, a.id, 'create'); // lease-expiry re-run
    expect(fake.events.size).toBe(1);
    const r = await rowOf(a.id);
    expect(r.sync_status).toBe('synced');
    expect(fake.events.has(r.provider_event_id!)).toBe(true);
    // the same slot is now taken by our own appointment (propagation-lag cover)
    fake.busy = [];
    await expect(createAppointment(owner, { title: 'Dup', ...slot(11, 15) })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('[I3.6] reschedule is version-checked and updates the event; cancel removes it', async (ctx) => {
    if (!ready) return ctx.skip();
    await expect(
      rescheduleAppointment(owner, apptId, { version: version + 5, ...slot(14) }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    const moved = await rescheduleAppointment(owner, apptId, { version, ...slot(14) });
    await syncAppointment(ws, apptId, 'update');
    expect([...fake.events.values()][0]!.start.toISOString()).toBe(at(14));
    const gone = await cancelAppointment(owner, apptId, moved.version);
    expect(gone.status).toBe('cancelled');
    await syncAppointment(ws, apptId, 'cancel');
    expect([...fake.events.values()][0]!.cancelled).toBe(true);
  });
});

describe('[I3.2] token health', () => {
  it('[I3.2] invalid_grant on refresh marks the connection needs_reconnect and the employee not bookable', async (ctx) => {
    if (!ready) return ctx.skip();
    fake.refreshError = new ProviderError('auth', 'google_invalid_grant');
    const later = new Date(Date.now() + 2 * 3600_000); // cached access token is expired by then -> refresh
    await expect(accessTokenFor(ws, uid, later)).rejects.toMatchObject({ kind: 'auth' });
    const row = await withOwner((c) =>
      c.query(`select status from integration_connections where user_id = $1`, [uid]),
    );
    expect(row.rows[0].status).toBe('needs_reconnect');
    expect((await team(owner)).members.find((m) => m.userId === uid)).toMatchObject({
      bookable: false,
      reason: 'needs_reconnect',
    });
    await expect(createAppointment(owner, { title: 'x', ...slot(16) })).rejects.toMatchObject({
      details: { reason: 'needs_reconnect' },
    });
    fake.refreshError = null;
  });
});
