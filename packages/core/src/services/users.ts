// Users service (docs/06-security.md §2, F1.*). Owner: Lane B (T-101/T-102; T-103…T-105 extend it).
// Services return already-masked DTOs shaped by @relay/contracts; route handlers stay thin.
import type { MeResponse, SessionSummary, UserSummary } from '@relay/contracts/api/users';
import { PERMISSION_KEYS } from '@relay/contracts/permissions';
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { AppError, notFound } from '../errors';
import * as repo from '../repos/identity';

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
  const page = await withWorkspaceTx(
    actor.workspaceId,
    (tx) => repo.listUsers(tx, actor.workspaceId, { cursor: query.cursor, limit: query.limit ?? 50 }),
    opts,
  );
  return { items: page.items.map(toSummary), nextCursor: page.nextCursor };
}

/** GET /api/v1/users/:id (users.manage). Another workspace's id → 404 (RLS + explicit filter). */
export async function get(actor: Actor, id: string, opts: TxOptions = {}): Promise<UserSummary> {
  assertPermission(actor, 'users.manage');
  const row = await withWorkspaceTx(actor.workspaceId, (tx) => repo.getUser(tx, actor.workspaceId, id), opts);
  if (!row) throw notFound();
  return toSummary(row);
}

export const usersService = { me, toMeResponse, mySessions, revokeMySession, list, get };
