// [F1.1][F1.8][Q1] Sign up, log in, sessions on real Postgres (code under test runs as app_user).
import { randomInt, randomUUID } from 'node:crypto';
import { closeDb, withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOwner } from '../../../db/test/helpers';
import { append, verifyChain } from '../../src/audit/index';
import { hashSessionToken, requireRotation, resolveSession } from '../../src/auth/sessions';
import { authService } from '../../src/services/auth';
import { usersService } from '../../src/services/users';

afterAll(async () => {
  await closeDb();
});

const PASSWORD = 'correct horse battery';
const uniq = () => randomUUID().slice(0, 8);
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const email = (tag = 'u') => `${tag}-${randomUUID()}@Relay.Test`;

async function signupOwner(overrides: Partial<Parameters<typeof authService.signup>[0]> = {}) {
  return authService.signup(
    {
      workspaceName: `Acme ${uniq()}`,
      name: 'Ayesha',
      email: email('owner'),
      password: PASSWORD,
      ...overrides,
    },
    { ip: ip(), userAgent: 'vitest' },
  );
}

async function owner<T>(q: string, params: unknown[] = []): Promise<T[]> {
  return withOwner(async (c) => (await c.query(q, params)).rows as T[]);
}

describe('[F1.1] sign up', () => {
  it('[F1.1] creates workspace + Owner + level defaults + Manager role + audit + a live session', async () => {
    const r = await signupOwner({ locale: 'ur' });
    expect(r.me.user).toMatchObject({ baseLevel: 'owner', locale: 'ur', name: 'Ayesha' });
    expect(r.me.workspace.id).toBe(r.me.user.workspaceId);
    expect(r.me.permissions).toContain('audit.view');
    const ws = r.me.workspace.id;
    const [w] = await owner<{ owner_user_id: string; slug: string }>(
      'select owner_user_id, slug from workspaces where id = $1',
      [ws],
    );
    expect(w!.owner_user_id).toBe(r.me.user.id);
    expect(w!.slug).toMatch(/^acme-[0-9a-f]{8}-[0-9a-f]{6}$/); // slugified name + random suffix
    const levels = await owner<{ base_level: string }>(
      'select base_level from level_permissions where workspace_id = $1 order by base_level',
      [ws],
    );
    expect(levels.map((l) => l.base_level)).toEqual(['admin', 'user']);
    const roles = await owner<{ key: string; name: string }>(
      'select key, name from roles where workspace_id = $1',
      [ws],
    );
    expect(roles).toEqual([{ key: 'manager', name: 'Manager' }]);
    const audit = await owner<{ action: string; seq: string; actor_type: string }>(
      'select action, seq, actor_type from audit_events where workspace_id = $1',
      [ws],
    );
    expect(audit).toEqual([{ action: 'workspace.created', seq: '1', actor_type: 'user' }]);
    expect((await resolveSession(r.session.token))?.actor.userId).toBe(r.me.user.id);
  });

  it('[Q1] stores only an argon2id hash (OWASP params), never the password', async () => {
    const r = await signupOwner();
    const [u] = await owner<{ password_hash: string }>('select password_hash from users where id = $1', [
      r.me.user.id,
    ]);
    expect(u!.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(u!.password_hash).not.toContain(PASSWORD);
  });

  it('[F1.1] duplicate email (any case) → EMAIL_TAKEN and nothing half-created', async () => {
    const e = email('dup');
    await signupOwner({ email: e });
    const name = `Dup ${uniq()}`;
    await expect(signupOwner({ email: e.toUpperCase(), workspaceName: name })).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
      httpStatus: 409,
    });
    expect(await owner('select 1 from workspaces where name = $1', [name])).toEqual([]);
  });

  it('[Q1] rejects short and common passwords with field-level codes', async () => {
    await expect(signupOwner({ password: 'short' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: 'password', code: 'password_too_short' }] },
    });
    await expect(signupOwner({ password: 'Password123' })).rejects.toMatchObject({
      details: { issues: [{ path: 'password', code: 'password_too_common' }] },
    });
  });
});

describe('[F1.1][Q1] log in, sessions', () => {
  it('[F1.1] login issues a session that keeps resolving (refresh keeps the user signed in)', async () => {
    const e = email();
    const s = await signupOwner({ email: e });
    const l = await authService.login({ email: e.toLowerCase(), password: PASSWORD }, { ip: ip() });
    expect(l.me.user.id).toBe(s.me.user.id);
    for (let i = 0; i < 3; i++)
      expect((await resolveSession(l.session.token))?.actor.userId).toBe(s.me.user.id);
  });

  it('[Q1] unknown email and wrong password get the same INVALID_CREDENTIALS', async () => {
    const e = email();
    await signupOwner({ email: e });
    const wrong = await authService
      .login({ email: e, password: 'not the password' }, { ip: ip() })
      .catch((x) => x);
    const unknown = await authService
      .login({ email: email('nobody'), password: PASSWORD }, { ip: ip() })
      .catch((x) => x);
    expect(wrong).toMatchObject({ code: 'INVALID_CREDENTIALS', httpStatus: 401 });
    expect(unknown).toMatchObject({ code: 'INVALID_CREDENTIALS', httpStatus: 401 });
  });

  it('[Q1] the 6th bad password for an email within a minute is rate-limited (429), even from new IPs', async () => {
    const e = email();
    await signupOwner({ email: e });
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const err = await authService
        .login({ email: e, password: `wrong-${i}-password` }, { ip: ip() })
        .catch((x) => x);
      codes.push(err.code);
    }
    expect(codes).toEqual([...Array(5).fill('INVALID_CREDENTIALS'), 'RATE_LIMITED']);
    // The right password is refused too while the window lasts.
    await expect(authService.login({ email: e, password: PASSWORD }, { ip: ip() })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      httpStatus: 429,
      details: { retryAfter: expect.any(Number) },
    });
  });

  it('[Q1] per-IP limit: 21st attempt from one IP within 15 min is rate-limited', async () => {
    const from = ip();
    const codes: string[] = [];
    for (let i = 0; i < 21; i++) {
      const err = await authService
        .login({ email: email('spray'), password: PASSWORD }, { ip: from })
        .catch((x) => x);
      codes.push(err.code);
    }
    expect(codes.slice(0, 20).every((c) => c === 'INVALID_CREDENTIALS')).toBe(true);
    expect(codes[20]).toBe('RATE_LIMITED');
  });

  it('[F1.8] a deactivated user cannot log in and their open session stops resolving', async () => {
    const e = email();
    const s = await signupOwner({ email: e });
    await owner('update users set is_active = false, deactivated_at = now() where id = $1', [s.me.user.id]);
    expect(await resolveSession(s.session.token)).toBeNull();
    await expect(authService.login({ email: e, password: PASSWORD }, { ip: ip() })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('[Q1] logout revokes the session; garbage tokens resolve to null', async () => {
    const s = await signupOwner();
    await authService.logout(s.session.token);
    expect(await resolveSession(s.session.token)).toBeNull();
    await authService.logout(s.session.token); // idempotent
    expect(await resolveSession('not-a-token')).toBeNull();
    expect(await resolveSession('A'.repeat(43))).toBeNull();
  });

  it('[Q1] idle expiry (7 d since last seen) and absolute expiry (30 d) end sessions', async () => {
    const a = await signupOwner();
    const b = await signupOwner();
    await owner(`update sessions set last_seen_at = now() - interval '8 days' where token_hash = $1`, [
      hashSessionToken(a.session.token),
    ]);
    await owner(`update sessions set expires_at = now() - interval '1 second' where token_hash = $1`, [
      hashSessionToken(b.session.token),
    ]);
    expect(await resolveSession(a.session.token)).toBeNull();
    expect(await resolveSession(b.session.token)).toBeNull();
    const [row] = await owner<{ days: number }>(
      `select round(extract(epoch from expires_at - created_at) / 86400)::int as days from sessions where user_id = $1`,
      [a.me.user.id],
    );
    expect(row!.days).toBe(30);
  });

  it('[Q1] last_seen_at slides, but is written at most every 5 minutes', async () => {
    const s = await signupOwner();
    const h = hashSessionToken(s.session.token);
    await owner(`update sessions set last_seen_at = now() - interval '2 minutes' where token_hash = $1`, [h]);
    await resolveSession(s.session.token);
    const [fresh] = await owner<{ age: number }>(
      `select extract(epoch from now() - last_seen_at)::int as age from sessions where token_hash = $1`,
      [h],
    );
    expect(fresh!.age).toBeGreaterThanOrEqual(110); // untouched
    await owner(`update sessions set last_seen_at = now() - interval '6 minutes' where token_hash = $1`, [h]);
    await resolveSession(s.session.token);
    const [touched] = await owner<{ age: number }>(
      `select extract(epoch from now() - last_seen_at)::int as age from sessions where token_hash = $1`,
      [h],
    );
    expect(touched!.age).toBeLessThan(5);
  });

  it('[Q1] login rotates: the previous cookie of this browser is revoked', async () => {
    const e = email();
    const s = await signupOwner({ email: e });
    const l = await authService.login(
      { email: e, password: PASSWORD },
      { ip: ip(), currentToken: s.session.token },
    );
    expect(await resolveSession(s.session.token)).toBeNull();
    expect(await resolveSession(l.session.token)).not.toBeNull();
  });

  it('[Q1] privilege change → next API request rotates the token (old dies, expiry kept); pages never rotate', async () => {
    const s = await signupOwner();
    const ws = s.me.workspace.id;
    await withWorkspaceTx(ws, (tx) => requireRotation(tx, ws, s.me.user.id));
    const page = await resolveSession(s.session.token, { allowRotate: false });
    expect(page?.rotated).toBeUndefined();
    const api = await resolveSession(s.session.token, { allowRotate: true });
    expect(api?.rotated?.token).toBeDefined();
    expect(api!.rotated!.expiresAt.getTime()).toBe(s.session.expiresAt.getTime());
    expect(await resolveSession(s.session.token)).toBeNull();
    const next = await resolveSession(api!.rotated!.token, { allowRotate: true });
    expect(next?.rotated).toBeUndefined();
    expect(next?.actor.sessionId).toBe(api!.actor.sessionId);
  });
});

describe('[F1.8] own sessions', () => {
  it('[F1.8] lists own sessions with the current one flagged; revoking one ends it; others → 404', async () => {
    const e = email();
    const s = await signupOwner({ email: e });
    const second = await authService.login({ email: e, password: PASSWORD }, { ip: ip() });
    const actor = (await resolveSession(s.session.token))!.actor;
    const list = await usersService.mySessions(actor);
    expect(list.items).toHaveLength(2);
    expect(list.items.filter((i) => i.current).map((i) => i.id)).toEqual([actor.sessionId]);
    const other = list.items.find((i) => !i.current)!;
    await usersService.revokeMySession(actor, other.id);
    expect(await resolveSession(second.session.token)).toBeNull();
    await expect(usersService.revokeMySession(actor, other.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Someone else's session (other workspace) is indistinguishable from a random id.
    const stranger = await signupOwner();
    const strangerActor = (await resolveSession(stranger.session.token))!.actor;
    await expect(usersService.revokeMySession(actor, strangerActor.sessionId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
    expect(await resolveSession(stranger.session.token)).not.toBeNull();
    // Audited (user.sessions_revoked) and the chain still verifies.
    const ws = actor.workspaceId;
    const actions = await owner<{ action: string }>(
      'select action from audit_events where workspace_id = $1 order by seq',
      [ws],
    );
    expect(actions.map((a) => a.action)).toEqual(['workspace.created', 'user.sessions_revoked']);
    expect((await withWorkspaceTx(ws, (tx) => verifyChain(tx, ws))).ok).toBe(true);
  });

  it("[F4.1] a user actor is recorded with actor_type 'user' and its id", async () => {
    const s = await signupOwner();
    const actor = (await resolveSession(s.session.token))!.actor;
    await withWorkspaceTx(actor.workspaceId, (tx) =>
      append(tx, actor, { action: 'role.created', targetType: 'role', targetId: 'r1', after: { name: 'X' } }),
    );
    const rows = await withWorkspaceTx(actor.workspaceId, (tx) =>
      tx.execute(
        sql`select actor_type, actor_user_id, after from audit_events where action = 'role.created'`,
      ),
    );
    expect(rows.rows).toEqual([{ actor_type: 'user', actor_user_id: actor.userId, after: { name: 'X' } }]);
  });
});
