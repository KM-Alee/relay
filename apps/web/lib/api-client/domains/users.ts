// api.users.*: owner Lane B. One method per endpoint in contracts/api/users.ts (13 §4).
import { usersEndpoints } from '@relay/contracts/api/users';
import { usersFixtures } from '@relay/contracts/fixtures/users';
import { call, type CallOptions } from '../http';

export const users = {
  me: (opts?: CallOptions) => call('users', usersEndpoints.me, {}, () => usersFixtures.me(), opts),
  mySessions: (opts?: CallOptions) =>
    call('users', usersEndpoints.mySessions, {}, () => usersFixtures.mySessions(), opts),
  revokeMySession: (id: string, opts?: CallOptions) =>
    call(
      'users',
      usersEndpoints.revokeMySession,
      { params: { id } },
      () => usersFixtures.revokeMySession(),
      opts,
    ),
  list: (query: { cursor?: string; limit?: number } = {}, opts?: CallOptions) =>
    call('users', usersEndpoints.list, { query }, () => usersFixtures.list(), opts),
  get: (id: string, opts?: CallOptions) =>
    call('users', usersEndpoints.get, { params: { id } }, () => usersFixtures.get(), opts),
};
