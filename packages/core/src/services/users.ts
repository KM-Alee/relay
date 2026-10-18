// Users service (docs/06-security.md §2, F1.*). Owner: Lane B (T-101/T-102; T-103…T-105 extend it).
// Services return already-masked DTOs shaped by @relay/contracts; route handlers stay thin.
import type { MeResponse, SessionSummary, UserSummary } from '@relay/contracts/api/users';
import { PERMISSION_KEYS } from '@relay/contracts/permissions';
import type { z } from 'zod';
import type { deactivateUserBody, updateUserBody } from '@relay/contracts/api/team-admin';
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission, OWNER_ONLY_GRANTS } from '../auth/permissions';
import { requireRotation, revokeAllSessions } from '../auth/sessions';
import { runDeactivationGuards, runUserDeactivatedHooks } from '../auth/user-lifecycle';
import { AppError, forbidden, notFound, staleVersion } from '../errors';
import { emit } from '../realtime/index';
import * as repo from '../repos/identity';
import * as admin from '../repos/team-admin';

export interface MeProfile {
  user: Omit<MeResponse['user'], 'id' | 'workspaceId' | 'baseLevel' | 'locale'>;
  workspace: MeResponse['workspace'];
  settings: Record<string, unknown>;
}

/** `ff_*` booleans of workspaces.settings (10 §2). */
export function flagsOf(settings: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(settings))
    if (k.startsWith('ff_') && typeof v === 'boolean') out[k] = v;
  return out;
}

/** Pure shaping of GET /api/v1/me from the actor + its loaded profile. */
export function toMeResponse(actor: Actor, profile: MeProfile): MeResponse {
  return {
    user: {
      id: actor.userId,
      workspaceId: actor.workspaceId,
      baseLevel: actor.baseLevel,
      locale: actor.locale,
      ...profile.user,
    },
    workspace: profile.workspace,
    permissions: actor.baseLevel === 'owner' ? [...PERMISSION_KEYS] : [...actor.permissions].sort(),
    flags: flagsOf(profile.settings),
  };
}

/** GET /api/v1/me: actor + profile + workspace + flags. */
export async function me(actor: Actor, opts: TxOptions = {}): Promise<MeResponse> {
  const p = await withWorkspaceTx(
    actor.workspaceId,
    (tx) => repo.profile(tx, actor.workspaceId, actor.userId),
    opts,
  );
  if (!p) throw new AppError('UNAUTHENTICATED');
  const { settings, ...workspace } = p.workspace;
  return toMeResponse(actor, { user: p.user, workspace, settings });
}

const iso = (d: Date) => d.toISOString();

/** GET /api/v1/me/sessions (F1.8): own live sessions, current one flagged. */
export async function mySessions(actor: Actor, opts: TxOptions = {}): Promise<{ items: SessionSummary[] }> {
  const rows = await withWorkspaceTx(
    actor.workspaceId,
    (tx) => repo.listLiveSessions(tx, actor.workspaceId, actor.userId),
    opts,
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      createdAt: iso(r.createdAt),
      lastSeenAt: iso(r.lastSeenAt),
      expiresAt: iso(r.expiresAt),
      ip: r.ip,
      userAgent: r.userAgent,
      current: r.id === actor.sessionId,
    })),
  };
}

/** DELETE /api/v1/me/sessions/:id (F1.8): end one of your own sessions. Not yours / unknown → 404. */
export async function revokeMySession(actor: Actor, sessionId: string, opts: TxOptions = {}): Promise<void> {
  await withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const ok = await repo.revokeSession(tx, actor.workspaceId, sessionId, actor.userId);
      if (!ok) throw notFound();
      await auditAppend(tx, actor, {
        action: 'user.sessions_revoked',
        targetType: 'user',
        targetId: actor.userId,
        meta: { sessionId, scope: 'one', self: true },
      });
    },
    opts,
  );
}

const toSummary = (r: repo.UserRow): UserSummary => ({ ...r });

/** GET /api/v1/users (users.manage): keyset page of the workspace's users. */
export async function list(
  actor: Actor,
  query: { cursor?: string; limit?: number },
  opts: TxOptions = {},
): Promise<{ items: UserSummary[]; nextCursor: string | null }> {
  assertPermission(actor, 'users.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const page = await repo.listUsers(tx, actor.workspaceId, {
        cursor: query.cursor,
        limit: query.limit ?? 50,
      });
      const load = await admin.openLoadByUser(
        tx,
        actor.workspaceId,
        page.items.map((u) => u.id),
      );
      return {
        items: page.items.map((u) => ({ ...toSummary(u), openLoad: load.get(u.id) ?? 0 })),
        nextCursor: page.nextCursor,
      };
    },
    opts,
  );
}

/** GET /api/v1/users/:id (users.manage). Another workspace's id → 404 (RLS + explicit filter). */
export async function get(actor: Actor, id: string, opts: TxOptions = {}): Promise<UserSummary> {
  assertPermission(actor, 'users.manage');
  const row = await withWorkspaceTx(actor.workspaceId, (tx) => repo.getUser(tx, actor.workspaceId, id), opts);
  if (!row) throw notFound();
  return toSummary(row);
}

type TargetUser = NonNullable<Awaited<ReturnType<typeof admin.lockUser>>>;

/** Owner-protection (06 §2): nobody except the Owner touches the Owner's level, roles, sessions, status. */
function assertMayTouch(actor: Actor, target: Pick<TargetUser, 'baseLevel'>): void {
  if (target.baseLevel === 'owner' && actor.baseLevel !== 'owner')
    throw forbidden({ reason: 'owner_protected' });
}
const rule = (reason: string) => new AppError('BUSINESS_RULE_VIOLATION', { details: { reason } });

async function lockTarget(tx: Parameters<typeof admin.lockUser>[0], actor: Actor, id: string) {
  const target = await admin.lockUser(tx, actor.workspaceId, id);
  if (!target) throw notFound();
  assertMayTouch(actor, target);
  return target;
}

async function summaryOf(tx: Parameters<typeof admin.lockUser>[0], actor: Actor, id: string) {
  const row = await repo.getUser(tx, actor.workspaceId, id);
  if (!row) throw notFound();
  return { ...toSummary(row), openLoad: 0 };
}

/**
 * PATCH /api/v1/users/:id (users.manage; F1.2, F1.7): base level and/or roles. Optimistic `version`.
 * Takes effect on the user's next request (effective permissions are loaded per request) and their
 * sessions rotate (`requireRotation`). Audited.
 */
export async function update(
  actor: Actor,
  id: string,
  input: z.infer<typeof updateUserBody>,
  opts: TxOptions = {},
): Promise<UserSummary> {
  assertPermission(actor, 'users.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const target = await lockTarget(tx, actor, id);
      if (target.version !== input.version) throw staleVersion(target.version);
      const isOwner = actor.baseLevel === 'owner';
      if (!isOwner && id === actor.userId) throw forbidden({ reason: 'self_change' });
      let changed = false;

      if (input.baseLevel && input.baseLevel !== target.baseLevel) {
        if (target.baseLevel === 'owner') throw rule('owner_level_fixed');
        if (!isOwner && (input.baseLevel === 'admin' || target.baseLevel === 'admin'))
          throw forbidden({ reason: 'admin_level_owner_only' });
        await admin.setUserLevel(tx, actor.workspaceId, id, input.baseLevel);
        await auditAppend(tx, actor, {
          action: 'user.level_changed',
          targetType: 'user',
          targetId: id,
          before: { baseLevel: target.baseLevel },
          after: { baseLevel: input.baseLevel },
        });
        changed = true;
      }

      if (input.roleIds) {
        const wanted = [...new Set(input.roleIds)];
        const known = await admin.existingRoleIds(tx, actor.workspaceId, wanted);
        if (known.size !== wanted.length) throw notFound({ what: 'role' });
        const current = await admin.userRoleIds(tx, actor.workspaceId, id);
        const same = current.length === wanted.length && current.every((r) => wanted.includes(r));
        if (!same) {
          if (!isOwner) {
            const added = wanted.filter((r) => !current.includes(r));
            const rs = (await admin.listRoles(tx, actor.workspaceId)).filter((r) => added.includes(r.id));
            if (
              rs.some((r) => r.permissions.some((p) => (OWNER_ONLY_GRANTS as readonly string[]).includes(p)))
            )
              throw forbidden({ reason: 'owner_only_grant' });
          }
          await admin.replaceUserRoles(tx, actor.workspaceId, id, wanted);
          await auditAppend(tx, actor, {
            action: 'user.roles_changed',
            targetType: 'user',
            targetId: id,
            before: { roleIds: current },
            after: { roleIds: wanted },
          });
          changed = true;
        }
      }

      if (changed) {
        await admin.bumpUserVersion(tx, actor.workspaceId, id);
        await requireRotation(tx, actor.workspaceId, id);
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'team', ids: [id] });
      }
      return summaryOf(tx, actor, id);
    },
    opts,
  );
}

/**
 * POST /api/v1/users/:id/deactivate (users.manage; F1.8): never a hard delete. One transaction: guards
 * (e.g. fallback owner, registered by Lane A) → is_active=false → ALL sessions revoked (the next request
 * is 401) → onUserDeactivated hooks (lead transfer, T-127) → audit.
 */
export async function deactivate(
  actor: Actor,
  id: string,
  input: z.infer<typeof deactivateUserBody> = {},
  opts: TxOptions = {},
): Promise<UserSummary> {
  assertPermission(actor, 'users.manage');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const target = await lockTarget(tx, actor, id);
      if (input.version !== undefined && target.version !== input.version) throw staleVersion(target.version);
      if (!target.isActive) return summaryOf(tx, actor, id);
      if (target.baseLevel === 'owner') throw rule('owner_cannot_be_deactivated');
      if (id === actor.userId) throw rule('cannot_deactivate_self');
      const ctx = { workspaceId: actor.workspaceId, userId: id, actor };
      await runDeactivationGuards(tx, ctx);
      await admin.markDeactivated(tx, actor.workspaceId, id);
      const revoked = await revokeAllSessions(tx, actor.workspaceId, id);
      await runUserDeactivatedHooks(tx, ctx);
      await auditAppend(tx, actor, {
        action: 'user.deactivated',
        targetType: 'user',
        targetId: id,
        before: { isActive: true },
        after: { isActive: false },
        meta: { sessionsRevoked: revoked },
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team', ids: [id] });
      return summaryOf(tx, actor, id);
    },
    opts,
  );
}

/** DELETE /api/v1/users/:id/sessions (F1.8): the OWNER ends every session of any user. */
export async function endUserSessions(
  actor: Actor,
  id: string,
  opts: TxOptions = {},
): Promise<{ revoked: number }> {
  assertPermission(actor, 'users.manage');
  if (actor.baseLevel !== 'owner') throw forbidden({ reason: 'owner_only' });
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      if (!(await admin.lockUser(tx, actor.workspaceId, id))) throw notFound();
      const revoked = await revokeAllSessions(tx, actor.workspaceId, id);
      await auditAppend(tx, actor, {
        action: 'user.sessions_revoked',
        targetType: 'user',
        targetId: id,
        meta: { scope: 'all', revoked, self: id === actor.userId },
      });
      return { revoked };
    },
    opts,
  );
}

export const usersService = {
  me,
  toMeResponse,
  mySessions,
  revokeMySession,
  list,
  get,
  update,
  deactivate,
  endUserSessions,
};
