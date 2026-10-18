// Seed + test factories (T-010, 13 §3). Owner: Lane B. They write with whatever Db/Tx they are given:
// `pnpm db:seed` passes the OWNER connection (local/preview only); integration tests may pass an owner
// Db for fixtures. Every insert is idempotent (fixed ids + ON CONFLICT DO NOTHING), so re-running is safe.
// Runtime code never uses these: signup goes through core/services/auth (app_user + RLS).
import { LEVEL_DEFAULTS, MANAGER_ROLE } from '@relay/contracts/permission-defaults';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/client';
import { levelPermissions, roles, users, workspaces } from '../src/schema/index';
import type { Tx } from '../src/tx';

type DbLike = Db | Tx;

/** Known dev password for every seed account (local/demo only, never production data). */
export const DEV_PASSWORD = 'relay-dev-password';
/** argon2id(DEV_PASSWORD) with the app's params (m=19456,t=2,p=1); precomputed so seeds need no argon2. */
export const DEV_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$lM9SYa67n1Llz1E2qzeO8w$gndG/1ndAhlUNkvXG+q7wi6W9HZBNlxwYeoAXt3ES5s';

export interface WorkspaceSpec {
  id: string;
  name: string;
  slug: string;
  demoMode?: boolean;
  defaultLocale?: 'en' | 'ur';
}

export interface UserSpec {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  baseLevel: 'owner' | 'admin' | 'user';
  locale?: 'en' | 'ur';
  passwordHash?: string;
  /** Role keys to assign (e.g. ['manager']). */
  roles?: string[];
}

/** Workspace + level defaults + the seeded Manager role (same defaults as signup). */
export async function createWorkspace(db: DbLike, w: WorkspaceSpec, managerRoleId: string): Promise<void> {
  await db
    .insert(workspaces)
    .values({
      id: w.id,
      name: w.name,
      slug: w.slug,
      demoMode: w.demoMode ?? true,
      defaultLocale: w.defaultLocale ?? 'en',
    })
    .onConflictDoNothing();
  for (const level of ['admin', 'user'] as const)
    await db
      .insert(levelPermissions)
      .values({ workspaceId: w.id, baseLevel: level, permissions: [...LEVEL_DEFAULTS[level]] })
      .onConflictDoNothing();
  await db
    .insert(roles)
    .values({
      id: managerRoleId,
      workspaceId: w.id,
      key: MANAGER_ROLE.key,
      name: MANAGER_ROLE.name,
      permissions: [...MANAGER_ROLE.permissions],
    })
    .onConflictDoNothing();
}

export async function createUser(db: DbLike, u: UserSpec): Promise<void> {
  await db
    .insert(users)
    .values({
      id: u.id,
      workspaceId: u.workspaceId,
      email: u.email,
      name: u.name,
      baseLevel: u.baseLevel,
      locale: u.locale ?? 'en',
      passwordHash: u.passwordHash ?? DEV_PASSWORD_HASH,
    })
    .onConflictDoNothing();
  if (u.baseLevel === 'owner')
    await db
      .update(workspaces)
      .set({ ownerUserId: u.id })
      .where(sql`${workspaces.id} = ${u.workspaceId}`);
  for (const key of u.roles ?? []) {
    await db.execute(sql`
      insert into user_roles (workspace_id, user_id, role_id)
      select ${u.workspaceId}, ${u.id}, r.id from roles r where r.workspace_id = ${u.workspaceId} and r.key = ${key}
      on conflict do nothing`);
  }
}
