// Dev login (13 §5, T-010). Owner: Lane B. Lists the seed users and signs in as one of them with a real
// session. Callers MUST guard with the dev-tools check (NODE_ENV=development AND DEMO_MODE): the routes
// return 404 otherwise. Only ids of the fixed seed set are accepted, read per seed workspace under RLS
// (no cross-workspace "list all users" door exists).
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import { users } from '@relay/db/schema';
import { SEED_USERS, SEED_WORKSPACES } from '@relay/db/seed';
import { and, eq, inArray } from 'drizzle-orm';
import { createSession, resolveSession, type ClientInfo } from '../auth/sessions';
import { notFound } from '../errors';
import type { AuthResult } from './auth';
import { me } from './users';

export interface SeedUserSummary {
  userId: string;
  email: string;
  displayName: string;
  baseLevel: 'owner' | 'admin' | 'user';
  roles: string[];
  workspaceName: string;
}

export async function listSeedUsers(opts: TxOptions = {}): Promise<SeedUserSummary[]> {
  const out: SeedUserSummary[] = [];
  for (const [i, w] of SEED_WORKSPACES.entries()) {
    const ids = SEED_USERS.filter((u) => u.ws === i).map((u) => u.id);
    const rows = await withWorkspaceTx(
      w.id,
      (tx) =>
        tx
          .select({ id: users.id, email: users.email, name: users.name, baseLevel: users.baseLevel })
          .from(users)
          .where(and(eq(users.workspaceId, w.id), inArray(users.id, ids), eq(users.isActive, true))),
      opts,
    );
    for (const u of SEED_USERS.filter((s) => s.ws === i)) {
      const r = rows.find((x) => x.id === u.id);
      if (r)
        out.push({
          userId: r.id,
          email: r.email,
          displayName: r.name,
          baseLevel: r.baseLevel,
          roles: [...u.roles],
          workspaceName: w.name,
        });
    }
  }
  return out;
}

/** Create a real session for a seed user (unknown/non-seed/inactive id → 404). */
export async function loginAs(
  userId: string,
  client: ClientInfo = {},
  opts: TxOptions = {},
): Promise<AuthResult> {
  const seed = SEED_USERS.find((u) => u.id === userId);
  if (!seed) throw notFound();
  const ws = SEED_WORKSPACES[seed.ws].id;
  const session = await withWorkspaceTx(
    ws,
    async (tx) => {
      const [u] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.workspaceId, ws), eq(users.id, userId), eq(users.isActive, true)));
      if (!u) throw notFound();
      return createSession(tx, { workspaceId: ws, userId, ...client });
    },
    opts,
  );
  const resolved = await resolveSession(session.token, { db: opts.db });
  if (!resolved) throw notFound();
  return { me: await me(resolved.actor, opts), session };
}

export const devLoginService = { listSeedUsers, loginAs };
