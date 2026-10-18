// api.users.*: owner Lane B. One method per endpoint in contracts/api/users.ts (13 §4).
import { usersEndpoints } from '@relay/contracts/api/users';
import { usersFixtures } from '@relay/contracts/fixtures/users';
import { call, type CallOptions } from '../http';

export const users = {
  me: (opts?: CallOptions) => call('users', usersEndpoints.me, {}, () => usersFixtures.me(), opts),
};
