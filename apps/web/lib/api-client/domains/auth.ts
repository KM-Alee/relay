// api.auth.*: owner Lane B. One method per endpoint in contracts/api/auth.ts (13 §4).
import { authEndpoints, type LoginBody, type SignupBody } from '@relay/contracts/api/auth';
import { authFixtures } from '@relay/contracts/fixtures/auth';
import { call, type CallOptions } from '../http';

export const auth = {
  signup: (body: SignupBody, opts?: CallOptions) =>
    call('auth', authEndpoints.signup, { body }, () => authFixtures.signup(), opts),
  login: (body: LoginBody, opts?: CallOptions) =>
    call('auth', authEndpoints.login, { body }, () => authFixtures.login(), opts),
  logout: (opts?: CallOptions) => call('auth', authEndpoints.logout, {}, () => authFixtures.logout(), opts),
  devSeedUsers: (opts?: CallOptions) =>
    call('auth', authEndpoints.devSeedUsers, {}, () => authFixtures.devSeedUsers(), opts),
  devLoginAs: (userId: string, opts?: CallOptions) =>
    call('auth', authEndpoints.devLoginAs, { body: { userId } }, () => authFixtures.devLoginAs(), opts),
};
