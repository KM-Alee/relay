// Seed: identity (T-010). Owner: Lane B. Idempotent (fixed ids). T-211 enriches the demo workspaces.
// One command (`pnpm db:reset && pnpm db:seed`) → login-able workspaces, password DEV_PASSWORD for all.
import { createUser, createWorkspace, DEV_PASSWORD } from './factories';
import type { SeedModule } from './types';

export { DEV_PASSWORD };

export const SEED_WORKSPACES = [
  { id: '0192f3a0-0000-7000-8000-000000000001', name: 'Sunrise Solar', slug: 'sunrise-solar' },
  { id: '0192f3a0-0000-7000-8000-000000000002', name: 'Crescent Realty', slug: 'crescent-realty' },
] as const;

const MANAGER_ROLE_IDS = ['0192f3a0-0000-7000-8000-000000000a01', '0192f3a0-0000-7000-8000-000000000a02'];

export const SEED_USERS = [
  {
    id: '0192f3a0-0000-7000-8000-000000000101',
    ws: 0,
    email: 'owner@sunrise.test',
    name: 'Ayesha Khan',
    baseLevel: 'owner',
    roles: [],
  },
  {
    id: '0192f3a0-0000-7000-8000-000000000102',
    ws: 0,
    email: 'admin@sunrise.test',
    name: 'Usman Tariq',
    baseLevel: 'admin',
    roles: [],
  },
  {
    id: '0192f3a0-0000-7000-8000-000000000103',
    ws: 0,
    email: 'manager@sunrise.test',
    name: 'Sana Malik',
    baseLevel: 'user',
    roles: ['manager'],
  },
  {
    id: '0192f3a0-0000-7000-8000-000000000104',
    ws: 0,
    email: 'user@sunrise.test',
    name: 'Bilal Ahmed',
    baseLevel: 'user',
    roles: [],
  },
  {
    id: '0192f3a0-0000-7000-8000-000000000105',
    ws: 0,
    email: 'user2@sunrise.test',
    name: 'Hina Raza',
    baseLevel: 'user',
    roles: [],
    locale: 'ur',
  },
  {
    id: '0192f3a0-0000-7000-8000-000000000201',
    ws: 1,
    email: 'owner@crescent.test',
    name: 'Imran Qureshi',
    baseLevel: 'owner',
    roles: [],
  },
  {
    id: '0192f3a0-0000-7000-8000-000000000202',
    ws: 1,
    email: 'user@crescent.test',
    name: 'Zara Sheikh',
    baseLevel: 'user',
    roles: [],
  },
] as const satisfies readonly {
  id: string;
  ws: number;
  email: string;
  name: string;
  baseLevel: 'owner' | 'admin' | 'user';
  roles: readonly string[];
  locale?: 'en' | 'ur';
}[];

export const identitySeed: SeedModule = {
  name: 'identity',
  run: async ({ db, log }) => {
    for (const [i, w] of SEED_WORKSPACES.entries()) await createWorkspace(db, w, MANAGER_ROLE_IDS[i]!);
    for (const u of SEED_USERS)
      await createUser(db, {
        id: u.id,
        workspaceId: SEED_WORKSPACES[u.ws].id,
        email: u.email,
        name: u.name,
        baseLevel: u.baseLevel,
        locale: 'locale' in u ? u.locale : 'en',
        roles: [...u.roles],
      });
    log(`  ${SEED_USERS.length} users in ${SEED_WORKSPACES.length} workspaces, password: ${DEV_PASSWORD}`);
  },
};
