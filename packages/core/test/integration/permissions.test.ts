// [F1.3][F1.5][F1.6][F1.7][Q2] Effective permissions from the DB, 403 without permission, 404 out of scope.
import { randomUUID } from 'node:crypto';
import { closeDb } from '@relay/db';
import { afterAll, describe, expect, it } from 'vitest';
import { withOwner } from '../../../db/test/helpers';
import { resolveSession } from '../../src/auth/sessions';
import { hashPassword } from '../../src/auth/passwords';
import { authService } from '../../src/services/auth';
import { usersService } from '../../src/services/users';

afterAll(async () => {
  await closeDb();
});

const PASSWORD = 'correct horse battery';
const q = (sql: string, p: unknown[] = []) => withOwner((c) => c.query(sql, p));

async function workspaceWithUser() {
  const o = await authService.signup(
    { workspaceName: 'Perm', name: 'Owner', email: `o-${randomUUID()}@t.test`, password: PASSWORD },
    { ip: '10.9.9.9' },
  );
  const ws = o.me.workspace.id;
  const userId = randomUUID();
  const email = `u-${randomUUID()}@t.test`;
  await q(
    `insert into users (id, workspace_id, email, name, password_hash, base_level) values ($1,$2,$3,'U',$4,'user')`,
    [userId, ws, email, await hashPassword(PASSWORD)],
  );
  const u = await authService.login(
    { email, password: PASSWORD },
    { ip: `10.8.${Math.floor(Math.random() * 250)}.1` },
  );
  return { ws, ownerToken: o.session.token, ownerId: o.me.user.id, userId, userToken: u.session.token };
}

const actorOf = async (token: string) => (await resolveSession(token))!.actor;

describe('[F1.5][Q2] server-side permission + scope', () => {
  it('[F1.5] a User calling GET /users (users.manage) is refused with 403', async () => {
    const w = await workspaceWithUser();
    await expect(usersService.list(await actorOf(w.userToken), {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
      httpStatus: 403,
    });
    const page = await usersService.list(await actorOf(w.ownerToken), {});
    expect(page.items.map((u) => u.id).sort()).toEqual([w.ownerId, w.userId].sort());
  });

  it("[F1.6][Q2] another workspace's user id → 404, even for its Owner-level peer", async () => {
    const a = await workspaceWithUser();
    const b = await workspaceWithUser();
    await expect(usersService.get(await actorOf(a.ownerToken), b.userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      httpStatus: 404,
    });
    expect((await usersService.get(await actorOf(a.ownerToken), a.userId)).id).toBe(a.userId);
  });

  it('[F1.7][F1.3] assigning the seeded Manager role / an override applies on the NEXT request', async () => {
    const w = await workspaceWithUser();
    expect((await actorOf(w.userToken)).permissions.has('leads.view_all')).toBe(false);
    await q(
      `insert into user_roles (workspace_id, user_id, role_id) select $1, $2, id from roles where workspace_id = $1 and key = 'manager'`,
      [w.ws, w.userId],
    );
    const m = await actorOf(w.userToken);
    expect(m.permissions.has('leads.view_all')).toBe(true);
    expect(m.permissions.has('crm.opportunity.value.view')).toBe(true);
    await q(
      `insert into user_permission_overrides (workspace_id, user_id, permission, effect) values ($1, $2, 'leads.view_all', 'deny'), ($1, $2, 'users.manage', 'grant')`,
      [w.ws, w.userId],
    );
    const o = await actorOf(w.userToken);
    expect(o.permissions.has('leads.view_all')).toBe(false);
    expect((await usersService.list(o, {})).items.length).toBe(2); // users.manage granted
    expect((await usersService.me(o)).permissions).toContain('users.manage');
  });
});
