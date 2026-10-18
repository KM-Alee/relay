// api.teams.*: owner Lane A. One method per endpoint in contracts/api/teams.ts; pattern: ./users.ts.
import type { Availability } from '@relay/contracts/api/users';
import { teamsEndpoints } from '@relay/contracts/api/teams';
import { teamsFixtures } from '@relay/contracts/fixtures/teams';
import { call, type CallOptions } from '../http';

export const teams = {
  list: (opts?: CallOptions) => call('teams', teamsEndpoints.list, {}, () => teamsFixtures.list(), opts),
  setAvailability: (userId: string, availability: Availability, opts?: CallOptions) =>
    call(
      'teams',
      teamsEndpoints.setAvailability,
      { params: { id: userId }, body: { availability } },
      () => teamsFixtures.setAvailability(),
      opts,
    ),
};
