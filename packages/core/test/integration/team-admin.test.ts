// [F1.2][F1.3][F1.7][F1.8][F4.2] Invites, roles, owner-protection, deactivation, audit list: real Postgres.
import { randomUUID } from 'node:crypto';
import { closeDb } from '@relay/db';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveSession } from '../../src/auth/sessions';
import { onUserDeactivated } from '../../src/auth/user-lifecycle';
import { authService } from '../../src/services/auth';
import { auditService } from '../../src/services/audit';
import { invitesService } from '../../src/services/invites';
import { rolesService } from '../../src/services/roles';
import { usersService } from '../../src/services/users';

afterAll(async () => {
  await closeDb();
});

const PASSWORD = 'correct horse battery';
const email = (t = 'u') => `${t}-${randomUUID()}@relay.test`;

async function workspace() {
  const r = await authService.signup(
    {
      workspaceName: `Acme ${randomUUID().slice(0, 6)}`,
      name: 'Owner',
      email: email('owner'),
      password: PASSWORD,
    },
    { ip: '10.0.0.1' },
  );
  const owner = (await resolveSession(r.session.token))!.actor;
  return { owner, ownerToken: r.session.token };
}

async function join(
  owner: Awaited<ReturnType<typeof workspace>>['owner'],
  level: 'admin' | 'user' = 'user',
  roleId?: string,
) {
  const inv = await invitesService.create(owner, { baseLevel: level, roleId });
  const token = inv.link.split('/invite/')[1]!;
  const em = email(level);
  const acc = await invitesService.accept(
    { token, name: `New ${level}`, email: em, password: PASSWORD },
    { ip: '10.0.0.2' },
  );
  const actor = (await resolveSession(acc.session.token))!.actor;
  return { token, actor, sessionToken: acc.session.token, invite: inv.invite };
}

describe('[F1.2] invites', () => {
  it('[F1.2] single-use: accept joins that workspace; a second use, a revoked and an expired link fail with INVITE_INVALID', async () => {
    const { owner } = await workspace();
    const a = await join(owner);
    expect(a.actor.workspaceId).toBe(owner.workspaceId);
    expect(a.actor.baseLevel).toBe('user');
    await expect(
      invitesService.accept({ token: a.token, name: 'Again', email: email(), password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'INVITE_INVALID' });

    const inv = await invitesService.create(owner, { baseLevel: 'user' });
    await invitesService.revoke(owner, inv.invite.id);
    const t = inv.link.split('/invite/')[1]!;
    await expect(invitesService.preview(t)).rejects.toMatchObject({ code: 'INVITE_INVALID' });
    const list = await invitesService.list(owner);
    expect(list.items.map((i) => i.status).sort()).toEqual(['revoked', 'used']);
  });

  it('[F1.2] an Admin cannot invite admins; the invited level is what the user gets', async () => {
    const { owner } = await workspace();
    const admin = (await join(owner, 'admin')).actor;
    expect(admin.baseLevel).toBe('admin');
    await expect(invitesService.create(admin, { baseLevel: 'admin' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('[F1.3][F1.7] roles and owner-protection', () => {
  it('[F1.7] a role grant applies on the very next request and the session rotates; [F1.3] audited', async () => {
    const { owner } = await workspace();
    const u = await join(owner);
    expect(u.actor.permissions.has('crm.export')).toBe(false);
    const role = await rolesService.createRole(owner, { name: 'Exporter', permissions: [] });
    const row = (await usersService.list(owner, {})).items.find((x) => x.id === u.actor.userId)!;
    await usersService.update(owner, row.id, { version: row.version, roleIds: [role.id] });
    await rolesService.updateRole(owner, role.id, { version: role.version, permissions: ['crm.export'] });
    const next = await resolveSession(u.sessionToken, { allowRotate: true });
    expect(next!.actor.permissions.has('crm.export')).toBe(true);
    expect(next!.rotated).toBeDefined();
    const { items } = await auditService.list(owner, { type: 'role' });
    expect(items.map((e) => e.action)).toEqual(['role.updated', 'role.created']);
    await expect(
      rolesService.updateRole(owner, role.id, { version: role.version, permissions: [] }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });

  it('[F1.2] an Admin cannot modify the Owner, promote admins or grant roles.manage', async () => {
    const { owner } = await workspace();
    const admin = (await join(owner, 'admin')).actor;
    const user = (await join(owner)).actor;
    const users = (await usersService.list(owner, {})).items;
    const ownerRow = users.find((u) => u.id === owner.userId)!;
    const userRow = users.find((u) => u.id === user.userId)!;
    await expect(
      usersService.update(admin, ownerRow.id, { version: ownerRow.version, baseLevel: 'user' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(usersService.deactivate(admin, ownerRow.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(usersService.endUserSessions(admin, userRow.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      usersService.update(admin, userRow.id, { version: userRow.version, baseLevel: 'admin' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(rolesService.createRole(admin, { name: 'X', permissions: [] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(usersService.deactivate(owner, owner.userId)).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
    });
  });

  it('[F1.3] user overrides: deny wins over the level grant, reported as effective', async () => {
    const { owner } = await workspace();
    const u = (await join(owner)).actor;
    const r = await rolesService.setOverrides(owner, u.userId, {
      items: [
        { permission: 'crm.contact.view', effect: 'deny' },
        { permission: 'crm.export', effect: 'grant' },
      ],
    });
    expect(r.effective).toContain('crm.export');
    expect(r.effective).not.toContain('crm.contact.view');
  });
});

describe('[F1.8] deactivation', () => {
  it('[F1.8] deactivate ends every session (401 next call), runs the lifecycle hook in the same tx, stays audited', async () => {
    const { owner } = await workspace();
    const u = await join(owner);
    const seen: string[] = [];
    const off = onUserDeactivated(async (_tx, c) => {
      seen.push(c.userId);
    });
    const row = (await usersService.list(owner, {})).items.find((x) => x.id === u.actor.userId)!;
    const out = await usersService.deactivate(owner, row.id, { version: row.version });
    off();
    expect(out.isActive).toBe(false);
    expect(seen).toEqual([u.actor.userId]);
    expect(await resolveSession(u.sessionToken)).toBeNull();
    const a = await auditService.list(owner, { type: 'user.deactivated' });
    expect(a.items).toHaveLength(1);
  });

  it('[F1.8] a failing hook rolls the deactivation back', async () => {
    const { owner } = await workspace();
    const u = await join(owner);
    const off = onUserDeactivated(async () => {
      throw new Error('boom');
    });
    await expect(usersService.deactivate(owner, u.actor.userId)).rejects.toThrow();
    off();
    expect(await resolveSession(u.sessionToken)).not.toBeNull();
  });
});

describe('[F4.2] audit list', () => {
  it('[F4.2] needs audit.view; filters by user and date; keyset pages newest first', async () => {
    const { owner } = await workspace();
    const admin = (await join(owner, 'admin')).actor;
    await expect(auditService.list(admin, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const all = await auditService.list(owner, { limit: 2 });
    expect(all.items).toHaveLength(2);
    expect(all.items[0]!.seq).toBeGreaterThan(all.items[1]!.seq);
    expect(all.nextCursor).not.toBeNull();
    const mine = await auditService.list(owner, { userId: owner.userId });
    expect(mine.items.every((e) => e.actorUserId === owner.userId)).toBe(true);
    const future = await auditService.list(owner, { from: '2999-01-01' });
    expect(future.items).toHaveLength(0);
  });
});
