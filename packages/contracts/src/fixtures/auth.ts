// Fixture builders for auth contracts (13 §4). Owner: Lane B. Pattern: ./users.ts.
import type { z } from 'zod';
import type { devSeedUsersResponse } from '../api/auth';
import { buildMe, FIXTURE_OWNER_ID, FIXTURE_USER_ID } from './users';

export function buildDevSeedUsers(): z.infer<typeof devSeedUsersResponse> {
  return {
    users: [
      {
        userId: FIXTURE_OWNER_ID,
        email: 'owner@sunrise.test',
        displayName: 'Ayesha Khan',
        baseLevel: 'owner',
        roles: [],
        workspaceName: 'Sunrise Solar',
      },
      {
        userId: FIXTURE_USER_ID,
        email: 'user@sunrise.test',
        displayName: 'Bilal Ahmed',
        baseLevel: 'user',
        roles: [],
        workspaceName: 'Sunrise Solar',
      },
    ],
  };
}

/** One entry per endpoint in authEndpoints, used by the api-client in fixture mode. */
export const authFixtures = {
  signup: () => buildMe(),
  login: () => buildMe(),
  logout: () => undefined,
  devSeedUsers: () => buildDevSeedUsers(),
  devLoginAs: () => buildMe(),
};
