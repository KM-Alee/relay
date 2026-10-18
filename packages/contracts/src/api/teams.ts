// teams API contracts: Zod request/response schemas + endpoint descriptors (docs/11-api.md). Owner: Lane A.
// F3.2 availability; routing settings shown read-only here (settings form: T-124 follow-up).
import { z } from 'zod';
import { endpoint } from './endpoint';
import { availabilitySchema } from './users';

export const teamMemberDto = z.object({
  userId: z.uuid(),
  name: z.string(),
  availability: availabilitySchema,
  isActive: z.boolean(),
  position: z.number().int(),
  /** Open handler leads (fallback custody excluded, 03 §11 Q1). */
  openLeads: z.number().int(),
  capacity: z.number().int(),
  version: z.number().int(),
});
export type TeamMemberDto = z.infer<typeof teamMemberDto>;

export const teamDto = z.object({
  id: z.uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  managerUserId: z.uuid().nullable(),
  backupUserId: z.uuid().nullable(),
  routingMode: z.enum(['round_robin', 'first_to_claim']),
  defaultCapacity: z.number().int(),
  ackWindowSeconds: z.number().int(),
  routingRetrySeconds: z.number().int(),
  idleSeconds: z.number().int(),
  members: z.array(teamMemberDto),
});
export type TeamDto = z.infer<typeof teamDto>;
export const teamsResponse = z.object({ items: z.array(teamDto) });

export const availabilityParams = z.object({ id: z.uuid() });
export const setAvailabilityInput = z.object({ availability: availabilitySchema }).strict();
export const setAvailabilityResponse = z.object({
  userId: z.uuid(),
  availability: availabilitySchema,
  /** Pending leads moved away by the absence rule (F3.6). Acknowledged leads stay. */
  reassignedLeadIds: z.array(z.uuid()),
  /** Acknowledged leads that stay with the absent owner (banner, F3.6 P0). */
  keptAcknowledgedLeadIds: z.array(z.uuid()),
});

export const teamsEndpoints = {
  /** GET /api/v1/teams (team.availability.view): teams + members + live availability. */
  list: endpoint({ method: 'GET', path: '/api/v1/teams', response: teamsResponse }),
  /** PATCH /api/v1/users/:id/availability: self, or `team.availability.manage` (F3.2, F3.6). */
  setAvailability: endpoint({
    method: 'PATCH',
    path: '/api/v1/users/:id/availability',
    params: availabilityParams,
    body: setAvailabilityInput,
    response: setAvailabilityResponse,
  }),
} as const;
