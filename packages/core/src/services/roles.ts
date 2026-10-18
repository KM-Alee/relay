// Roles, level defaults and per-user overrides (F1.2, F1.3, F1.7; docs/06-security.md §2). Owner: Lane B (T-104).
// Every mutation: assertPermission('roles.manage') → one tx → optimistic `version` (409 STALE_VERSION) →
// `requireRotation` for every affected user (their next request swaps the session token; effective
// permissions are re-read from the DB on every request, so the change applies on the NEXT request) →
// audit → realtime hint.
import type {
  createRoleBody,
  setOverridesBody,
  updateLevelPermissionsBody,
  updateRoleBody,
} from '@relay/contracts/api/team-admin';
import type { RoleSummary } from '@relay/contracts/api/team-admin';
import { withWorkspaceTx, type Tx, type TxOptions } from '@relay/db';
import type { z } from 'zod';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { loadEffectivePermissions } from '../auth/effective-permissions';
import {
  assertPermission,
  can,
  isPermissionKey,
  LEVEL_DEFAULTS,
  OWNER_ONLY_GRANTS,
  type PermissionKey,
} from '../auth/permissions';
import { requireRotation } from '../auth/sessions';
import { AppError, forbidden, notFound, staleVersion } from '../errors';
import { uuidv7 } from '../ids';
import { emit } from '../realtime/index';
import * as identity from '../repos/identity';
import * as repo from '../repos/team-admin';

type Level = 'admin' | 'user';

const dedupe = (p: readonly string[]) => [...new Set(p)].filter(isPermissionKey).sort();
const toRole = (r: repo.RoleRow): RoleSummary => ({
  ...r,
  permissions: dedupe(r.permissions) as PermissionKey[],
});

/** Reading the matrix is needed to assign roles (users.manage) as well as to edit them (roles.manage). */
function assertCanReadRoles(actor: Actor): void {
  if (!can(actor, 'users.manage') && !can(actor, 'roles.manage')) assertPermission(actor, 'roles.manage');
}

/** Only the Owner may hand out permissions reserved to the Owner (06 §2 Owner-protection). */
function assertGrantable(actor: Actor, added: readonly string[]): void {
  if (actor.baseLevel === 'owner') return;
  if (added.some((p) => (OWNER_ONLY_GRANTS as readonly string[]).includes(p)))
    throw forbidden({ reason: 'owner_only_grant' });
}

const diff = (before: readonly string[], after: readonly string[]) => ({
  added: after.filter((p) => !before.includes(p)),
  removed: before.filter((p) => !after.includes(p)),
});

async function rotate(tx: Tx, workspaceId: string, userIds: readonly string[]) {
  for (const id of userIds) await requireRotation(tx, workspaceId, id);
}

export async function listRoles(actor: Actor, opts: TxOptions = {}): Promise<{ items: RoleSummary[] }> {
  assertCanReadRoles(actor);
  const rows = await withWorkspaceTx(actor.workspaceId, (tx) => repo.listRoles(tx, actor.workspaceId), opts);
  return { items: rows.map(toRole) };
}

export async function createRole(
  actor: Actor,
  input: z.infer<typeof createRoleBody>,
  opts: TxOptions = {},
): Promise<RoleSummary> {
  assertPermission(actor, 'roles.manage');
  const permissions = dedupe(input.permissions);
  assertGrantable(actor, permissions);
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      if (await repo.roleNameTaken(tx, actor.workspaceId, input.name)) throw new AppError('CONFLICT');
      const id = uuidv7();
      await identity.insertRole(tx, {
        id,
        workspaceId: actor.workspaceId,
        key: null,
        name: input.name,
        permissions,
      });
      await auditAppend(tx, actor, {
        action: 'role.created',
        targetType: 'role',
        targetId: id,
        after: { name: input.name, permissions },
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team' });
      const row = (await repo.listRoles(tx, actor.workspaceId)).find((r) => r.id === id)!;
      return toRole(row);
    },
    opts,
  );
}

export async function updateRole(
  actor: Actor,
  id: string,
  input: z.infer<typeof updateRoleBody>,
  opts: TxOptions = {},
): Promise<RoleSummary> {
  assertPermission(actor, 'roles.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const role = await repo.lockRole(tx, actor.workspaceId, id);
      if (!role) throw notFound();
      if (role.version !== input.version) throw staleVersion(role.version);
      const permissions = input.permissions ? dedupe(input.permissions) : undefined;
      const d = diff(role.permissions, permissions ?? role.permissions);
      assertGrantable(actor, d.added);
      if (input.name && input.name !== role.name) {
        if (await repo.roleNameTaken(tx, actor.workspaceId, input.name, id)) throw new AppError('CONFLICT');
      }
      const ok = await repo.updateRole(tx, actor.workspaceId, id, input.version, {
        name: input.name,
        permissions,
      });
      if (!ok) throw staleVersion();
      await rotate(tx, actor.workspaceId, await repo.roleMemberIds(tx, actor.workspaceId, id));
      await auditAppend(tx, actor, {
        action: 'role.updated',
        targetType: 'role',
        targetId: id,
        before: { name: role.name, permissions: role.permissions },
        after: { name: input.name ?? role.name, permissions: permissions ?? role.permissions },
        meta: d,
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team' });
      return toRole((await repo.listRoles(tx, actor.workspaceId)).find((r) => r.id === id)!);
    },
    opts,
  );
}

export async function deleteRole(actor: Actor, id: string, opts: TxOptions = {}): Promise<void> {
  assertPermission(actor, 'roles.manage');
  await withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const role = await repo.lockRole(tx, actor.workspaceId, id);
      if (!role) throw notFound();
      if (role.key) throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'seeded_role' } });
      await rotate(tx, actor.workspaceId, await repo.roleMemberIds(tx, actor.workspaceId, id));
      await repo.deleteRole(tx, actor.workspaceId, id);
      await auditAppend(tx, actor, {
        action: 'role.deleted',
        targetType: 'role',
        targetId: id,
        before: { name: role.name, permissions: role.permissions },
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team' });
    },
    opts,
  );
}

// ── Level defaults ───────────────────────────────────────────────────────
export async function listLevelPermissions(actor: Actor, opts: TxOptions = {}) {
  assertCanReadRoles(actor);
  const rows = await withWorkspaceTx(
    actor.workspaceId,
    (tx) => repo.listLevelPermissions(tx, actor.workspaceId),
    opts,
  );
  const items = (['admin', 'user'] as const).map((level) => {
    const row = rows.find((r) => r.baseLevel === level);
    return {
      baseLevel: level,
      permissions: dedupe(row?.permissions ?? LEVEL_DEFAULTS[level]) as PermissionKey[],
      version: row?.version ?? 0,
    };
  });
  return { items };
}

export async function updateLevelPermissions(
  actor: Actor,
  level: Level,
  input: z.infer<typeof updateLevelPermissionsBody>,
  opts: TxOptions = {},
) {
  assertPermission(actor, 'roles.manage');
  const permissions = dedupe(input.permissions);
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const row = await repo.lockLevelPermissions(tx, actor.workspaceId, level);
      const before = row?.permissions ?? [...LEVEL_DEFAULTS[level]];
      if ((row?.version ?? 0) !== input.version) throw staleVersion(row?.version ?? 0);
      const d = diff(dedupe(before), permissions);
      assertGrantable(actor, d.added);
      const ok = await repo.writeLevelPermissions(
        tx,
        actor.workspaceId,
        level,
        permissions,
        input.version,
        !!row,
      );
      if (!ok) throw staleVersion();
      await rotate(tx, actor.workspaceId, await repo.usersOfLevel(tx, actor.workspaceId, level));
      await auditAppend(tx, actor, {
        action: 'role.updated',
        targetType: 'level_permissions',
        targetId: level,
        before: { permissions: dedupe(before) },
        after: { permissions },
        meta: d,
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team' });
      return { baseLevel: level, permissions: permissions as PermissionKey[], version: input.version + 1 };
    },
    opts,
  );
}

// ── Per-user overrides ───────────────────────────────────────────────────
async function overridesOf(tx: Tx, actor: Actor, userId: string, baseLevel: 'owner' | 'admin' | 'user') {
  const items = (await repo.listOverrides(tx, actor.workspaceId, userId)).filter((o) =>
    isPermissionKey(o.permission),
  ) as { permission: PermissionKey; effect: 'grant' | 'deny' }[];
  const effective = [...(await loadEffectivePermissions(tx, actor.workspaceId, userId, baseLevel))].sort();
  return { items, effective };
}

export async function getOverrides(actor: Actor, userId: string, opts: TxOptions = {}) {
  assertCanReadRoles(actor);
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const u = await repo.lockUser(tx, actor.workspaceId, userId);
      if (!u) throw notFound();
      return overridesOf(tx, actor, userId, u.baseLevel);
    },
    opts,
  );
}

export async function setOverrides(
  actor: Actor,
  userId: string,
  input: z.infer<typeof setOverridesBody>,
  opts: TxOptions = {},
) {
  assertPermission(actor, 'roles.manage');
  const seen = new Set<string>();
  const items = input.items.filter((i) => !seen.has(i.permission) && seen.add(i.permission));
  assertGrantable(
    actor,
    items.filter((i) => i.effect === 'grant').map((i) => i.permission),
  );
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const u = await repo.lockUser(tx, actor.workspaceId, userId);
      if (!u) throw notFound();
      if (u.baseLevel === 'owner')
        throw actor.baseLevel === 'owner'
          ? new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'owner_has_everything' } })
          : forbidden({ reason: 'owner_protected' });
      const before = await repo.listOverrides(tx, actor.workspaceId, userId);
      await repo.replaceOverrides(tx, actor.workspaceId, userId, items);
      await requireRotation(tx, actor.workspaceId, userId);
      await auditAppend(tx, actor, {
        action: 'user.permissions_changed',
        targetType: 'user',
        targetId: userId,
        before: { overrides: before },
        after: { overrides: items },
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team', ids: [userId] });
      return overridesOf(tx, actor, userId, u.baseLevel);
    },
    opts,
  );
}

export const rolesService = {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listLevelPermissions,
  updateLevelPermissions,
  getOverrides,
  setOverrides,
};
