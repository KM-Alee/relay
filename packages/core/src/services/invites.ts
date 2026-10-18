// Invitations (F1.2, docs/06-security.md §1). Owner: Lane B (T-103).
// Copy-link delivery: the link is returned ONCE at creation; only sha256(token) is stored. Accept is an
// atomic conditional UPDATE (used_at/revoked_at IS NULL, not expired) inside the same transaction that
// creates the user, so a link works once, in that workspace only; used / expired / revoked → 410.
import type { acceptInviteBody, createInviteBody, InviteSummary } from '@relay/contracts/api/team-admin';
import type { MeResponse } from '@relay/contracts/api/users';
import { withSystemTx, withWorkspaceTx, type TxOptions } from '@relay/db';
import type { z } from 'zod';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { hashPassword, passwordProblem } from '../auth/passwords';
import { assertPermission, OWNER_ONLY_GRANTS } from '../auth/permissions';
import {
  createSession,
  hashSessionToken,
  newSessionToken,
  resolveSession,
  type ClientInfo,
  type CreatedSession,
} from '../auth/sessions';
import { runUserJoinedHooks } from '../auth/user-lifecycle';
import { config } from '../config';
import { AppError, forbidden, notFound } from '../errors';
import { uuidv7 } from '../ids';
import { emit } from '../realtime/index';
import * as identity from '../repos/identity';
import * as repo from '../repos/team-admin';
import { me } from './users';

const toSummary = (r: repo.InviteRow): InviteSummary => ({
  id: r.id,
  baseLevel: r.baseLevel === 'admin' ? 'admin' : 'user',
  roleId: r.roleId,
  roleName: r.roleName,
  status: r.usedAt ? 'used' : r.revokedAt ? 'revoked' : r.expired ? 'expired' : 'pending',
  createdBy: r.createdBy,
  createdByName: r.createdByName,
  createdAt: r.createdAt.toISOString(),
  expiresAt: r.expiresAt.toISOString(),
  usedByName: r.usedByName,
});

const invalid = () => new AppError('INVITE_INVALID');
const normEmail = (e: string) => e.trim().toLowerCase();

/** POST /api/v1/invites (users.invite): create; returns the copyable link once. */
export async function create(
  actor: Actor,
  input: z.infer<typeof createInviteBody>,
  opts: TxOptions = {},
): Promise<{ invite: InviteSummary; link: string }> {
  assertPermission(actor, 'users.invite');
  // Only the Owner can invite admins (06 §1).
  if (input.baseLevel === 'admin' && actor.baseLevel !== 'owner')
    throw forbidden({ reason: 'admin_invite_owner_only' });
  const { token, hash } = newSessionToken();
  const id = uuidv7();
  const invite = await withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      if (input.roleId) {
        const role = (await repo.listRoles(tx, actor.workspaceId)).find((r) => r.id === input.roleId);
        if (!role) throw notFound({ what: 'role' });
        if (
          actor.baseLevel !== 'owner' &&
          role.permissions.some((p) => (OWNER_ONLY_GRANTS as readonly string[]).includes(p))
        )
          throw forbidden({ reason: 'owner_only_grant' });
      }
      const ttlHours = await repo.inviteTtlHours(tx, actor.workspaceId);
      await repo.insertInvite(tx, {
        id,
        workspaceId: actor.workspaceId,
        tokenHash: hash,
        baseLevel: input.baseLevel,
        roleId: input.roleId ?? null,
        createdBy: actor.userId,
        ttlHours,
      });
      await auditAppend(tx, actor, {
        action: 'user.invited',
        targetType: 'invite',
        targetId: id,
        after: { baseLevel: input.baseLevel, roleId: input.roleId ?? null, ttlHours },
      });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team' });
      return toSummary((await repo.listInvites(tx, actor.workspaceId, id))[0]!);
    },
    opts,
  );
  const base = config.core.PUBLIC_BASE_URL.replace(/\/+$/, '');
  return { invite, link: `${base}/${actor.locale}/invite/${token}` };
}

/** GET /api/v1/invites (users.invite): newest first, with computed status. */
export async function list(actor: Actor, opts: TxOptions = {}): Promise<{ items: InviteSummary[] }> {
  assertPermission(actor, 'users.invite');
  const rows = await withWorkspaceTx(
    actor.workspaceId,
    (tx) => repo.listInvites(tx, actor.workspaceId),
    opts,
  );
  return { items: rows.map(toSummary) };
}

/** DELETE /api/v1/invites/:id (users.invite): revoke a pending invite. */
export async function revoke(actor: Actor, id: string, opts: TxOptions = {}): Promise<void> {
  assertPermission(actor, 'users.invite');
  await withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      if (!(await repo.revokeInvite(tx, actor.workspaceId, id))) {
        const exists = (await repo.listInvites(tx, actor.workspaceId, id)).length > 0;
        throw exists ? new AppError('CONFLICT', { details: { reason: 'invite_not_pending' } }) : notFound();
      }
      await auditAppend(tx, actor, { action: 'invite.revoked', targetType: 'invite', targetId: id });
      await emit(tx, { workspaceId: actor.workspaceId, topic: 'team' });
    },
    opts,
  );
}

async function lookup(token: string, opts: TxOptions) {
  const hash = hashSessionToken(token);
  if (!hash) throw invalid();
  const found = await withSystemTx((tx) => repo.findInviteByTokenHash(tx, hash), opts);
  if (!found || !found.usable) throw invalid();
  return { found, hash };
}

/** POST /api/v1/invites/preview (public): what the link joins, without consuming it. */
export async function preview(token: string, opts: TxOptions = {}) {
  const { found } = await lookup(token, opts);
  return {
    workspaceName: found.workspaceName,
    baseLevel: found.baseLevel === 'admin' ? ('admin' as const) : ('user' as const),
    roleName: found.roleName,
    expiresAt: found.expiresAt.toISOString(),
  };
}

function isEmailTaken(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === 'users_email_key') return true;
  }
  return false;
}

/** POST /api/v1/invites/accept (public): creates the user in the invite's workspace only, signs them in. */
export async function accept(
  input: z.infer<typeof acceptInviteBody>,
  client: ClientInfo = {},
  opts: TxOptions = {},
): Promise<{ me: MeResponse; session: CreatedSession }> {
  const problem = passwordProblem(input.password);
  if (problem)
    throw new AppError('VALIDATION_FAILED', {
      details: { in: 'body', issues: [{ path: 'password', code: `password_${problem}` }] },
    });
  const { found } = await lookup(input.token, opts);
  const passwordHash = await hashPassword(input.password);
  const userId = uuidv7();
  const locale = input.locale ?? 'en';
  let session: CreatedSession;
  try {
    session = await withWorkspaceTx(
      found.workspaceId,
      async (tx) => {
        await identity.insertUser(tx, {
          id: userId,
          workspaceId: found.workspaceId,
          email: normEmail(input.email),
          name: input.name,
          passwordHash,
          baseLevel: found.baseLevel,
          locale,
        });
        // Atomic single use: a concurrent accept (or a revoke / expiry in between) makes this 0 rows.
        const used = await repo.consumeInvite(tx, found.workspaceId, found.inviteId, userId);
        if (!used.won) throw invalid();
        if (used.roleId) await identity.assignRole(tx, found.workspaceId, userId, used.roleId);
        const joined: Actor = {
          userId,
          workspaceId: found.workspaceId,
          sessionId: '',
          baseLevel: found.baseLevel,
          permissions: new Set(),
          locale,
        };
        await auditAppend(tx, joined, {
          action: 'user.joined',
          targetType: 'user',
          targetId: userId,
          after: { inviteId: found.inviteId, baseLevel: found.baseLevel, roleId: used.roleId },
        });
        await runUserJoinedHooks(tx, { workspaceId: found.workspaceId, userId, actor: joined });
        await emit(tx, { workspaceId: found.workspaceId, topic: 'team', ids: [userId] });
        return createSession(tx, { workspaceId: found.workspaceId, userId, ...client });
      },
      opts,
    );
  } catch (err) {
    if (isEmailTaken(err)) throw new AppError('EMAIL_TAKEN');
    throw err;
  }
  const resolved = await resolveSession(session.token, { ...client, db: opts.db });
  if (!resolved) throw new AppError('INTERNAL', { message: 'new session did not resolve' });
  return { me: await me(resolved.actor, opts), session };
}

export const invitesService = { create, list, revoke, preview, accept };
