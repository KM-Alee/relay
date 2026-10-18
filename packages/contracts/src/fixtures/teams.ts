// Fixture builders for teams contracts (13 §4). Owner: Lane A. Pattern: ./users.ts.
import type { TeamDto } from '../api/teams';
import { FIXTURE_USER_ID } from './users';

export function buildTeam(overrides: Partial<TeamDto> = {}): TeamDto {
  return {
    id: '0192f3a0-0000-7000-8002-000000000000',
    name: 'Sales',
    isDefault: true,
    managerUserId: '0192f3a0-0000-7000-8000-000000000103',
    backupUserId: '0192f3a0-0000-7000-8000-000000000102',
    routingMode: 'round_robin',
    defaultCapacity: 5,
    ackWindowSeconds: 120,
    routingRetrySeconds: 30,
    idleSeconds: 600,
    members: [
      {
        userId: FIXTURE_USER_ID,
        name: 'Bilal Ahmed',
        availability: 'available',
        isActive: true,
        position: 1,
        openLeads: 2,
        capacity: 5,
        version: 0,
      },
      {
        userId: '0192f3a0-0000-7000-8000-000000000105',
        name: 'Hina Raza',
        availability: 'on_leave',
        isActive: true,
        position: 2,
        openLeads: 0,
        capacity: 5,
        version: 0,
      },
    ],
    ...overrides,
  };
}

/** One entry per endpoint in teamsEndpoints, used by the api-client in fixture mode. */
export const teamsFixtures = {
  list: () => ({ items: [buildTeam()] }),
  setAvailability: () => ({
    userId: FIXTURE_USER_ID,
    availability: 'available' as const,
    reassignedLeadIds: [],
    keptAcknowledgedLeadIds: [],
  }),
} as const;
