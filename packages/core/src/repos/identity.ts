// Identity data access (users, sessions, roles, permissions). Repos take `tx: Tx`; services open the
// transaction (withWorkspaceTx, or withSystemTx for the SECURITY DEFINER doors). Owner: Lane B.
import type { Tx } from '@relay/db';
import {
  levelPermissions,
  roles,
  sessions,
  userPermissionOverrides,
  userRoles,
  users,
  workspaces,
  type NewUser,
} from '@relay/db/schema';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

type BaseLevel = 'owner' | 'admin' | 'user';

// ── SECURITY DEFINER doors (withSystemTx) ────────────────────────────────
export interface UserByEmail {
  userId: string;
  workspaceId: string;
  passwordHash: string;
  isActive: boolean;
}

export async function findUserByEmail(tx: Tx, email: string): Promise<UserByEmail | null> {
  const res = await tx.execute<{
    user_id: string;
    workspace_id: string;
    password_hash: string;
    is_active: boolean;
  }>(sql`select * from auth_find_user_by_email(${email})`);
  const r = res.rows[0];
  return r
    ? { userId: r.user_id, workspaceId: r.workspace_id, passwordHash: r.password_hash, isActive: r.is_active }
    : null;
}

export interface ResolvedSessionRow {
  sessionId: string;
  userId: string;
  workspaceId: string;
  baseLevel: BaseLevel;
  locale: 'en' | 'ur';
  expiresAt: Date;
  lastSeenAt: Date;
  rotateRequired: boolean;
}

export async function resolveSession(tx: Tx, tokenHash: Buffer): Promise<ResolvedSessionRow | null> {
  const res = await tx.execute<{
    session_id: string;
    user_id: string;
    workspace_id: string;
    base_level: BaseLevel;
    locale: string;
    expires_at: Date | string;
    last_seen_at: Date | string;
    rotate_required: boolean;
  }>(sql`select * from auth_resolve_session(${tokenHash})`);
  const r = res.rows[0];
  if (!r) return null;
  return {
    sessionId: r.session_id,
    userId: r.user_id,
    workspaceId: r.workspace_id,
    baseLevel: r.base_level,
    locale: r.locale === 'ur' ? 'ur' : 'en',
    expiresAt: new Date(r.expires_at),
    lastSeenAt: new Date(r.last_seen_at),
    rotateRequired: r.rotate_required,
  };
}

// ── Workspace + users (withWorkspaceTx) ──────────────────────────────────
export async function insertWorkspace(
  tx: Tx,
  w: { id: string; name: string; slug: string; defaultLocale: 'en' | 'ur'; timezone: string },
): Promise<void> {
  await tx.insert(workspaces).values(w);
}

export async function setWorkspaceOwner(tx: Tx, workspaceId: string, ownerUserId: string): Promise<void> {
  await tx.update(workspaces).set({ ownerUserId }).where(eq(workspaces.id, workspaceId));
}

export async function insertUser(tx: Tx, u: NewUser): Promise<void> {
  await tx.insert(users).values(u);
}

export async function upsertLevelPermissions(
  tx: Tx,
  workspaceId: string,
  baseLevel: BaseLevel,
  permissions: readonly string[],
): Promise<void> {
  await tx
    .insert(levelPermissions)
    .values({ workspaceId, baseLevel, permissions: [...permissions] })
    .onConflictDoNothing();
}

export async function insertRole(
  tx: Tx,
  r: { id: string; workspaceId: string; key: string | null; name: string; permissions: readonly string[] },
): Promise<void> {
  await tx.insert(roles).values({ ...r, permissions: [...r.permissions] });
}

export async function assignRole(tx: Tx, workspaceId: string, userId: string, roleId: string): Promise<void> {
  await tx.insert(userRoles).values({ workspaceId, userId, roleId }).onConflictDoNothing();
}

export async function updatePasswordHash(
  tx: Tx,
  workspaceId: string,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await tx
    .update(users)
    .set({ passwordHash })
    .where(and(eq(users.workspaceId, workspaceId), eq(users.id, userId)));
}

export interface PermissionSourceRows {
  level: string[] | null;
  roles: string[][];
  overrides: { permission: string; effect: 'grant' | 'deny' }[];
}

export async function permissionSources(
  tx: Tx,
  workspaceId: string,
  userId: string,
  baseLevel: BaseLevel,
): Promise<PermissionSourceRows> {
  const level = await tx
    .select({ permissions: levelPermissions.permissions })
    .from(levelPermissions)
    .where(and(eq(levelPermissions.workspaceId, workspaceId), eq(levelPermissions.baseLevel, baseLevel)));
  const rolePerms = await tx
    .select({ permissions: roles.permissions })
    .from(userRoles)
    .innerJoin(roles, and(eq(roles.workspaceId, userRoles.workspaceId), eq(roles.id, userRoles.roleId)))
    .where(and(eq(userRoles.workspaceId, workspaceId), eq(userRoles.userId, userId)));
  const overrides = await tx
    .select({ permission: userPermissionOverrides.permission, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides)
    .where(
      and(eq(userPermissionOverrides.workspaceId, workspaceId), eq(userPermissionOverrides.userId, userId)),
    );
  return { level: level[0]?.permissions ?? null, roles: rolePerms.map((r) => r.permissions), overrides };
}

export interface ProfileRow {
  user: {
    name: string;
    email: string;
    timezone: string;
    availability: 'available' | 'busy' | 'on_leave' | 'offline';
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    defaultLocale: 'en' | 'ur';
    demoMode: boolean;
    settings: Record<string, unknown>;
  };
}

export async function profile(tx: Tx, workspaceId: string, userId: string): Promise<ProfileRow | null> {
  const rows = await tx
    .select({
      name: users.name,
      email: users.email,
      timezone: users.timezone,
      availability: users.availability,
      wsId: workspaces.id,
      wsName: workspaces.name,
      wsSlug: workspaces.slug,
      wsTimezone: workspaces.timezone,
      wsCurrency: workspaces.currency,
      wsLocale: workspaces.defaultLocale,
      wsDemo: workspaces.demoMode,
      wsSettings: workspaces.settings,
    })
    .from(users)
    .innerJoin(workspaces, eq(workspaces.id, users.workspaceId))
    .where(and(eq(users.workspaceId, workspaceId), eq(users.id, userId)));
  const r = rows[0];
  if (!r) return null;
  return {
    user: { name: r.name, email: r.email, timezone: r.timezone, availability: r.availability },
    workspace: {
      id: r.wsId,
      name: r.wsName,
      slug: r.wsSlug,
      timezone: r.wsTimezone,
      currency: r.wsCurrency,
      defaultLocale: r.wsLocale === 'ur' ? 'ur' : 'en',
      demoMode: r.wsDemo,
      settings: (r.wsSettings ?? {}) as Record<string, unknown>,
    },
  };
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  baseLevel: BaseLevel;
  availability: 'available' | 'busy' | 'on_leave' | 'offline';
  isActive: boolean;
  locale: 'en' | 'ur';
  version: number;
  roles: { id: string; name: string }[];
}

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  baseLevel: users.baseLevel,
  availability: users.availability,
  isActive: users.isActive,
  locale: users.locale,
  version: users.version,
};

async function withRoles(tx: Tx, workspaceId: string, rows: Omit<UserRow, 'roles'>[]): Promise<UserRow[]> {
  if (rows.length === 0) return [];
  const rr = await tx
    .select({ userId: userRoles.userId, id: roles.id, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, and(eq(roles.workspaceId, userRoles.workspaceId), eq(roles.id, userRoles.roleId)))
    .where(
      and(
        eq(userRoles.workspaceId, workspaceId),
        inArray(
          userRoles.userId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(roles.name));
  return rows.map((r) => ({
    ...r,
    roles: rr.filter((x) => x.userId === r.id).map(({ id, name }) => ({ id, name })),
  }));
}

/** Keyset page by id (UUID v7 ≈ creation order). Fetches limit+1 to know if there is a next page. */
export async function listUsers(
  tx: Tx,
  workspaceId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: UserRow[]; nextCursor: string | null }> {
  const rows = await tx
    .select(userColumns)
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), opts.cursor ? gt(users.id, opts.cursor) : undefined))
    .orderBy(asc(users.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  return {
    items: await withRoles(tx, workspaceId, page),
    nextCursor: rows.length > opts.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function getUser(tx: Tx, workspaceId: string, id: string): Promise<UserRow | null> {
  const rows = await tx
    .select(userColumns)
    .from(users)
    .where(and(eq(users.workspaceId, workspaceId), eq(users.id, id)));
  const [r] = await withRoles(tx, workspaceId, rows);
  return r ?? null;
}

// ── Sessions (withWorkspaceTx) ───────────────────────────────────────────
export const SESSION_ABSOLUTE = sql`interval '30 days'`;

export async function insertSession(
  tx: Tx,
  s: {
    id: string;
    workspaceId: string;
    userId: string;
    tokenHash: Buffer;
    ip: string | null;
    userAgent: string | null;
    /** Keep an existing absolute expiry (rotation never extends a session's lifetime). */
    expiresAt?: Date;
  },
): Promise<{ expiresAt: Date }> {
  const [row] = await tx
    .insert(sessions)
    .values({
      id: s.id,
      workspaceId: s.workspaceId,
      userId: s.userId,
      tokenHash: s.tokenHash,
      ip: s.ip,
      userAgent: s.userAgent,
      expiresAt: s.expiresAt ?? sql`now() + ${SESSION_ABSOLUTE}`,
    })
    .returning({ expiresAt: sessions.expiresAt });
  return { expiresAt: row!.expiresAt };
}

/** Sliding idle window: bump last_seen_at at most every 5 min (06 §1). */
export async function touchSession(tx: Tx, workspaceId: string, sessionId: string): Promise<void> {
  await tx.execute(sql`
    update sessions set last_seen_at = now()
     where workspace_id = ${workspaceId} and id = ${sessionId}
       and revoked_at is null and last_seen_at < now() - interval '5 minutes'`);
}

/** Conditional revoke; true if this call revoked it (false: already revoked / not in workspace). */
export async function revokeSession(
  tx: Tx,
  workspaceId: string,
  sessionId: string,
  userId?: string,
): Promise<boolean> {
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(sessions.workspaceId, workspaceId),
        eq(sessions.id, sessionId),
        userId ? eq(sessions.userId, userId) : undefined,
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/** Revoke the session holding `tokenHash` in this workspace (login rotation, logout). */
export async function revokeSessionByTokenHash(
  tx: Tx,
  workspaceId: string,
  tokenHash: Buffer,
): Promise<boolean> {
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(sessions.workspaceId, workspaceId),
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });
  return rows.length > 0;
}

export async function revokeAllUserSessions(tx: Tx, workspaceId: string, userId: string): Promise<number> {
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(eq(sessions.workspaceId, workspaceId), eq(sessions.userId, userId), isNull(sessions.revokedAt)),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

export async function markRotateRequired(tx: Tx, workspaceId: string, userId: string): Promise<number> {
  const rows = await tx
    .update(sessions)
    .set({ rotateRequired: true })
    .where(
      and(eq(sessions.workspaceId, workspaceId), eq(sessions.userId, userId), isNull(sessions.revokedAt)),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

export interface SessionListRow {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export async function listLiveSessions(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<SessionListRow[]> {
  return tx
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.workspaceId, workspaceId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        sql`${sessions.expiresAt} > now()`,
        sql`${sessions.lastSeenAt} > now() - interval '7 days'`,
      ),
    )
    .orderBy(sql`${sessions.lastSeenAt} desc`);
}
