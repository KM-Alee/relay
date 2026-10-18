// Team administration data access: invites, roles, level defaults, overrides, user updates, audit reads,
// open load. Repos take `tx: Tx`; services own the transaction. Owner: Lane B (T-103/T-104/T-105/T-151).
import type { Tx } from '@relay/db';
import {
  auditEvents,
  invites,
  levelPermissions,
  roles,
  userPermissionOverrides,
  userRoles,
  users,
} from '@relay/db/schema';
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

type Level = 'owner' | 'admin' | 'user';

// ── Invites ──────────────────────────────────────────────────────────────
export interface InviteRow {
  id: string;
  baseLevel: Level;
  roleId: string | null;
  roleName: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedByName: string | null;
  revokedAt: Date | null;
  expired: boolean;
}

/** Newest first; `expired` is computed by the DB clock (now()). */
export async function listInvites(tx: Tx, workspaceId: string, onlyId?: string): Promise<InviteRow[]> {
  const res = await tx.execute<{
    id: string;
    base_level: Level;
    role_id: string | null;
    role_name: string | null;
    created_by: string;
    created_by_name: string | null;
    created_at: Date | string;
    expires_at: Date | string;
    used_at: Date | string | null;
    used_by_name: string | null;
    revoked_at: Date | string | null;
    expired: boolean;
  }>(sql`
    select i.id, i.base_level, i.role_id, r.name as role_name, i.created_by, c.name as created_by_name,
           i.created_at, i.expires_at, i.used_at, u.name as used_by_name, i.revoked_at,
           (i.expires_at <= now()) as expired
      from invites i
      left join roles r on r.workspace_id = i.workspace_id and r.id = i.role_id
      left join users c on c.workspace_id = i.workspace_id and c.id = i.created_by
      left join users u on u.workspace_id = i.workspace_id and u.id = i.used_by
     where i.workspace_id = ${workspaceId} ${onlyId ? sql`and i.id = ${onlyId}` : sql``}
     order by i.created_at desc
     limit 200`);
  const d = (v: Date | string | null) => (v === null ? null : new Date(v));
  return res.rows.map((r) => ({
    id: r.id,
    baseLevel: r.base_level,
    roleId: r.role_id,
    roleName: r.role_name,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: new Date(r.created_at),
    expiresAt: new Date(r.expires_at),
    usedAt: d(r.used_at),
    usedByName: r.used_by_name,
    revokedAt: d(r.revoked_at),
    expired: r.expired,
  }));
}

export async function insertInvite(
  tx: Tx,
  i: {
    id: string;
    workspaceId: string;
    tokenHash: Buffer;
    baseLevel: Level;
    roleId: string | null;
    createdBy: string;
    ttlHours: number;
  },
): Promise<void> {
  await tx.insert(invites).values({
    id: i.id,
    workspaceId: i.workspaceId,
    tokenHash: i.tokenHash,
    baseLevel: i.baseLevel,
    roleId: i.roleId,
    createdBy: i.createdBy,
    expiresAt: sql`now() + ${`${i.ttlHours} hours`}::interval`,
  });
}

/** Revoke a still-pending invite. false = unknown / already used / already revoked. */
export async function revokeInvite(tx: Tx, workspaceId: string, id: string): Promise<boolean> {
  const rows = await tx
    .update(invites)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(invites.workspaceId, workspaceId),
        eq(invites.id, id),
        isNull(invites.usedAt),
        isNull(invites.revokedAt),
      ),
    )
    .returning({ id: invites.id });
  return rows.length > 0;
}

/** SECURITY DEFINER door (withSystemTx): the invite behind a token hash, across workspaces. */
export interface InviteLookup {
  inviteId: string;
  workspaceId: string;
  workspaceName: string;
  baseLevel: Level;
  roleName: string | null;
  expiresAt: Date;
  usable: boolean;
}
export async function findInviteByTokenHash(tx: Tx, tokenHash: Buffer): Promise<InviteLookup | null> {
  const res = await tx.execute<{
    invite_id: string;
    workspace_id: string;
    workspace_name: string;
    base_level: Level;
    role_name: string | null;
    expires_at: Date | string;
    usable: boolean;
  }>(sql`select * from auth_find_invite(${tokenHash})`);
  const r = res.rows[0];
  return r
    ? {
        inviteId: r.invite_id,
        workspaceId: r.workspace_id,
        workspaceName: r.workspace_name,
        baseLevel: r.base_level,
        roleName: r.role_name,
        expiresAt: new Date(r.expires_at),
        usable: r.usable,
      }
    : null;
}

/**
 * Atomic single use (06 §1): only ONE concurrent accept wins. Returns the role id to assign, or null
 * (as `{won:false}`) when the invite was already used / revoked / expired.
 */
export async function consumeInvite(
  tx: Tx,
  workspaceId: string,
  inviteId: string,
  usedBy: string,
): Promise<{ won: false } | { won: true; baseLevel: Level; roleId: string | null }> {
  const rows = await tx
    .update(invites)
    .set({ usedAt: sql`now()`, usedBy })
    .where(
      and(
        eq(invites.workspaceId, workspaceId),
        eq(invites.id, inviteId),
        isNull(invites.usedAt),
        isNull(invites.revokedAt),
        sql`${invites.expiresAt} > now()`,
      ),
    )
    .returning({ baseLevel: invites.baseLevel, roleId: invites.roleId });
  const r = rows[0];
  return r ? { won: true, baseLevel: r.baseLevel, roleId: r.roleId } : { won: false };
}

export async function inviteTtlHours(tx: Tx, workspaceId: string): Promise<number> {
  const res = await tx.execute<{ ttl: string | null }>(
    sql`select settings ->> 'invite_ttl_hours' as ttl from workspaces where id = ${workspaceId}`,
  );
  const n = Number(res.rows[0]?.ttl);
  return Number.isFinite(n) && n > 0 && n <= 24 * 30 ? n : 72;
}

// ── Roles ────────────────────────────────────────────────────────────────
export interface RoleRow {
  id: string;
  key: string | null;
  name: string;
  permissions: string[];
  version: number;
  memberCount: number;
}

export async function listRoles(tx: Tx, workspaceId: string): Promise<RoleRow[]> {
  const rs = await tx
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      permissions: roles.permissions,
      version: roles.version,
    })
    .from(roles)
    .where(eq(roles.workspaceId, workspaceId))
    .orderBy(roles.createdAt);
  const counts = await tx
    .select({ roleId: userRoles.roleId, n: sql<number>`count(*)::int` })
    .from(userRoles)
    .where(eq(userRoles.workspaceId, workspaceId))
    .groupBy(userRoles.roleId);
  const byRole = new Map(counts.map((c) => [c.roleId, c.n]));
  return rs.map((r) => ({ ...r, memberCount: byRole.get(r.id) ?? 0 }));
}

export async function lockRole(tx: Tx, workspaceId: string, id: string) {
  const [r] = await tx
    .select()
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), eq(roles.id, id)))
    .for('update');
  return r ?? null;
}

export async function updateRole(
  tx: Tx,
  workspaceId: string,
  id: string,
  version: number,
  patch: { name?: string; permissions?: string[] },
): Promise<boolean> {
  const rows = await tx
    .update(roles)
    .set({ ...patch, version: sql`${roles.version} + 1` })
    .where(and(eq(roles.workspaceId, workspaceId), eq(roles.id, id), eq(roles.version, version)))
    .returning({ id: roles.id });
  return rows.length > 0;
}

export async function deleteRole(tx: Tx, workspaceId: string, id: string): Promise<void> {
  await tx
    .update(invites)
    .set({ roleId: null })
    .where(and(eq(invites.workspaceId, workspaceId), eq(invites.roleId, id)));
  await tx.delete(roles).where(and(eq(roles.workspaceId, workspaceId), eq(roles.id, id)));
}

export async function roleMemberIds(tx: Tx, workspaceId: string, roleId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(and(eq(userRoles.workspaceId, workspaceId), eq(userRoles.roleId, roleId)));
  return rows.map((r) => r.userId);
}

export async function usersOfLevel(tx: Tx, workspaceId: string, level: Level): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), eq(users.baseLevel, level)));
  return rows.map((r) => r.id);
}

export async function existingRoleIds(tx: Tx, workspaceId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), inArray(roles.id, ids)));
  return new Set(rows.map((r) => r.id));
}

export async function roleNameTaken(tx: Tx, workspaceId: string, name: string, exceptId?: string) {
  const rows = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), sql`lower(${roles.name}) = lower(${name})`));
  return rows.some((r) => r.id !== exceptId);
}

// ── Level defaults ───────────────────────────────────────────────────────
export async function listLevelPermissions(tx: Tx, workspaceId: string) {
  return tx
    .select({
      baseLevel: levelPermissions.baseLevel,
      permissions: levelPermissions.permissions,
      version: levelPermissions.version,
    })
    .from(levelPermissions)
    .where(eq(levelPermissions.workspaceId, workspaceId));
}

export async function lockLevelPermissions(tx: Tx, workspaceId: string, level: Level) {
  const [r] = await tx
    .select()
    .from(levelPermissions)
    .where(and(eq(levelPermissions.workspaceId, workspaceId), eq(levelPermissions.baseLevel, level)))
    .for('update');
  return r ?? null;
}

export async function writeLevelPermissions(
  tx: Tx,
  workspaceId: string,
  level: Level,
  permissions: string[],
  version: number,
  exists: boolean,
): Promise<boolean> {
  if (!exists) {
    await tx.insert(levelPermissions).values({ workspaceId, baseLevel: level, permissions, version: 1 });
    return true;
  }
  const rows = await tx
    .update(levelPermissions)
    .set({ permissions, version: sql`${levelPermissions.version} + 1` })
    .where(
      and(
        eq(levelPermissions.workspaceId, workspaceId),
        eq(levelPermissions.baseLevel, level),
        eq(levelPermissions.version, version),
      ),
    )
    .returning({ v: levelPermissions.version });
  return rows.length > 0;
}

// ── Overrides ────────────────────────────────────────────────────────────
export async function listOverrides(tx: Tx, workspaceId: string, userId: string) {
  return tx
    .select({ permission: userPermissionOverrides.permission, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides)
    .where(
      and(eq(userPermissionOverrides.workspaceId, workspaceId), eq(userPermissionOverrides.userId, userId)),
    )
    .orderBy(userPermissionOverrides.permission);
}

export async function replaceOverrides(
  tx: Tx,
  workspaceId: string,
  userId: string,
  items: { permission: string; effect: 'grant' | 'deny' }[],
): Promise<void> {
  await tx
    .delete(userPermissionOverrides)
    .where(
      and(eq(userPermissionOverrides.workspaceId, workspaceId), eq(userPermissionOverrides.userId, userId)),
    );
  if (items.length)
    await tx.insert(userPermissionOverrides).values(items.map((i) => ({ workspaceId, userId, ...i })));
}

// ── Users ────────────────────────────────────────────────────────────────
export async function lockUser(tx: Tx, workspaceId: string, id: string) {
  const [u] = await tx
    .select({
      id: users.id,
      name: users.name,
      baseLevel: users.baseLevel,
      isActive: users.isActive,
      version: users.version,
    })
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), eq(users.id, id)))
    .for('update');
  return u ?? null;
}

export async function userRoleIds(tx: Tx, workspaceId: string, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(and(eq(userRoles.workspaceId, workspaceId), eq(userRoles.userId, userId)));
  return rows.map((r) => r.roleId);
}

export async function replaceUserRoles(
  tx: Tx,
  workspaceId: string,
  userId: string,
  roleIds: string[],
): Promise<void> {
  await tx.delete(userRoles).where(and(eq(userRoles.workspaceId, workspaceId), eq(userRoles.userId, userId)));
  if (roleIds.length)
    await tx.insert(userRoles).values(roleIds.map((roleId) => ({ workspaceId, userId, roleId })));
}

export async function setUserLevel(tx: Tx, workspaceId: string, id: string, level: Level): Promise<void> {
  await tx
    .update(users)
    .set({ baseLevel: level })
    .where(and(eq(users.workspaceId, workspaceId), eq(users.id, id)));
}

export async function bumpUserVersion(tx: Tx, workspaceId: string, id: string): Promise<void> {
  await tx
    .update(users)
    .set({ version: sql`${users.version} + 1` })
    .where(and(eq(users.workspaceId, workspaceId), eq(users.id, id)));
}

export async function markDeactivated(tx: Tx, workspaceId: string, id: string): Promise<void> {
  await tx
    .update(users)
    .set({ isActive: false, deactivatedAt: sql`now()`, version: sql`${users.version} + 1` })
    .where(and(eq(users.workspaceId, workspaceId), eq(users.id, id)));
}

/**
 * Open lead load per user. The lead tables arrive with Lane A (T-122+); until then everyone has 0.
 * Swap the body for a `count(*) … group by owner_user_id` over open leads when they exist.
 */
export async function openLoadByUser(
  _tx: Tx,
  _workspaceId: string,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  return new Map(userIds.map((id) => [id, 0]));
}

// ── Audit reads (F4.2): SELECT only ──────────────────────────────────────
export interface AuditFilter {
  type?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  cursor?: number;
  limit: number;
}

export async function listAudit(tx: Tx, workspaceId: string, f: AuditFilter) {
  const rows = await tx
    .select({
      id: auditEvents.id,
      seq: auditEvents.seq,
      occurredAt: auditEvents.occurredAt,
      actorType: auditEvents.actorType,
      actorUserId: auditEvents.actorUserId,
      actorName: users.name,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      before: auditEvents.before,
      after: auditEvents.after,
      meta: auditEvents.meta,
    })
    .from(auditEvents)
    .leftJoin(
      users,
      and(eq(users.workspaceId, auditEvents.workspaceId), eq(users.id, auditEvents.actorUserId)),
    )
    .where(
      and(
        eq(auditEvents.workspaceId, workspaceId),
        f.type
          ? or(
              eq(auditEvents.action, f.type),
              sql`${auditEvents.action} like ${f.type.replace(/[%_]/g, '\\$&') + '.%'}`,
            )
          : undefined,
        f.userId ? eq(auditEvents.actorUserId, f.userId) : undefined,
        f.from ? gte(auditEvents.occurredAt, f.from) : undefined,
        f.to ? lte(auditEvents.occurredAt, f.to) : undefined,
        f.cursor ? lt(auditEvents.seq, f.cursor) : undefined,
      ),
    )
    .orderBy(desc(auditEvents.seq))
    .limit(f.limit + 1);
  return rows;
}
