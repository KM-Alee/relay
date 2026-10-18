// Auth use cases: sign up, log in, log out (docs/06-security.md §1, F1.1, Q1). Owner: Lane B (T-101).
// Route handlers call ONE of these and turn the returned token into the session cookie.
import { createHash } from 'node:crypto';
import type { LoginBody, SignupBody } from '@relay/contracts/api/auth';
import type { MeResponse } from '@relay/contracts/api/users';
import { withSystemTx, withWorkspaceTx, type TxOptions } from '@relay/db';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import {
  burnVerifyTime,
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyPassword,
} from '../auth/passwords';
import { provisionWorkspace } from '../auth/provisioning';
import {
  createSession,
  hashSessionToken,
  resolveSession,
  type ClientInfo,
  type CreatedSession,
} from '../auth/sessions';
import { AppError } from '../errors';
import { uuidv7 } from '../ids';
import * as repo from '../repos/identity';
import { enforce, type RateLimiter, consume } from './rate-limit';
import { me } from './users';

export interface AuthResult {
  me: MeResponse;
  session: CreatedSession;
}

export interface AuthDeps extends TxOptions {
  rateLimiter?: RateLimiter;
}

/** 06 §1 login limits: per IP 20 / 15 min, per email 5 / 15 min (the 6th attempt is refused). */
export const LOGIN_LIMITS = {
  ip: { limit: 20, windowSeconds: 900 },
  email: { limit: 5, windowSeconds: 900 },
} as const;

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const normEmail = (e: string) => e.trim().toLowerCase();

function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // Global uniqueness can't be checked across workspaces (RLS), so add a random suffix.
  return `${base || 'workspace'}-${uuidv7().slice(-6)}`;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === constraint) return true;
  }
  return false;
}

function passwordInvalid(code: string): AppError {
  return new AppError('VALIDATION_FAILED', { details: { in: 'body', issues: [{ path: 'password', code }] } });
}

async function meFor(token: string, client: ClientInfo, opts: TxOptions): Promise<MeResponse> {
  const resolved = await resolveSession(token, { ...client, db: opts.db });
  if (!resolved) throw new AppError('INTERNAL', { message: 'new session did not resolve' });
  return me(resolved.actor, opts);
}

/**
 * POST /api/v1/auth/signup (F1.1): ONE transaction creates the workspace, the Owner, level defaults,
 * the Manager role, every lane's provisioners (team/pipeline/… when they exist), the audit entry and the
 * first session.
 */
export async function signup(
  input: SignupBody,
  client: ClientInfo = {},
  opts: AuthDeps = {},
): Promise<AuthResult> {
  const problem = passwordProblem(input.password);
  if (problem) throw passwordInvalid(`password_${problem}`);
  const passwordHash = await hashPassword(input.password);
  const workspaceId = uuidv7();
  const userId = uuidv7();
  const locale = input.locale ?? 'en';
  const timezone = input.timezone ?? 'Asia/Karachi';

  let session: CreatedSession;
  try {
    session = await withWorkspaceTx(
      workspaceId,
      async (tx) => {
        await repo.insertWorkspace(tx, {
          id: workspaceId,
          name: input.workspaceName,
          slug: slugify(input.workspaceName),
          defaultLocale: locale,
          timezone,
        });
        await repo.insertUser(tx, {
          id: userId,
          workspaceId,
          email: normEmail(input.email),
          name: input.name,
          passwordHash,
          baseLevel: 'owner',
          locale,
          timezone,
        });
        await repo.setWorkspaceOwner(tx, workspaceId, userId);
        await provisionWorkspace(tx, { workspaceId, ownerUserId: userId, locale });
        const owner: Actor = {
          userId,
          workspaceId,
          sessionId: '',
          baseLevel: 'owner',
          permissions: new Set(),
          locale,
        };
        await auditAppend(tx, owner, {
          action: 'workspace.created',
          targetType: 'workspace',
          targetId: workspaceId,
          after: { name: input.workspaceName, ownerUserId: userId },
        });
        return createSession(tx, { workspaceId, userId, ...client });
      },
      opts,
    );
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_key')) throw new AppError('EMAIL_TAKEN');
    throw err;
  }
  return { me: await meFor(session.token, client, opts), session };
}

/**
 * POST /api/v1/auth/login (Q1): rate-limited per IP and per email BEFORE any lookup; one generic
 * INVALID_CREDENTIALS for unknown email, wrong password and deactivated users (with equalized timing).
 * A previous session cookie on this browser is revoked (rotation on login).
 */
export async function login(
  input: LoginBody,
  client: ClientInfo & { currentToken?: string | null } = {},
  opts: AuthDeps = {},
): Promise<AuthResult> {
  const limiter = opts.rateLimiter ?? ((r) => consume(r, { db: opts.db }));
  const email = normEmail(input.email);
  await enforce({ key: `login:ip:${client.ip ?? 'unknown'}`, ...LOGIN_LIMITS.ip }, limiter);
  await enforce({ key: `login:email:${sha256hex(email)}`, ...LOGIN_LIMITS.email }, limiter);

  const found = await withSystemTx((tx) => repo.findUserByEmail(tx, email), opts);
  if (!found) {
    await burnVerifyTime(input.password);
    throw new AppError('INVALID_CREDENTIALS');
  }
  const ok = await verifyPassword(found.passwordHash, input.password);
  if (!ok || !found.isActive) throw new AppError('INVALID_CREDENTIALS');

  const rehash = needsRehash(found.passwordHash) ? await hashPassword(input.password) : null;
  const previous = hashSessionToken(client.currentToken);
  const session = await withWorkspaceTx(
    found.workspaceId,
    async (tx) => {
      if (previous) await repo.revokeSessionByTokenHash(tx, found.workspaceId, previous);
      if (rehash) await repo.updatePasswordHash(tx, found.workspaceId, found.userId, rehash);
      return createSession(tx, { workspaceId: found.workspaceId, userId: found.userId, ...client });
    },
    opts,
  );
  return { me: await meFor(session.token, client, opts), session };
}

/** POST /api/v1/auth/logout: revoke the cookie's session if it is still live. Never fails. */
export async function logout(token: string | null | undefined, opts: TxOptions = {}): Promise<void> {
  const hash = hashSessionToken(token);
  if (!hash) return;
  const row = await withSystemTx((tx) => repo.resolveSession(tx, hash), opts);
  if (!row) return;
  await withWorkspaceTx(
    row.workspaceId,
    (tx) => repo.revokeSessionByTokenHash(tx, row.workspaceId, hash),
    opts,
  );
}

export const authService = { signup, login, logout };
