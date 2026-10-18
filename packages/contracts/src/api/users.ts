// Users / me contracts (docs/11-api.md "Auth & session", "Users, roles, teams"). Owner: Lane B.
// WORKED EXAMPLE of the endpoint pattern (13 §4 "How to add an endpoint in 5 steps").
import { z } from 'zod';
import { permissionKeySchema } from '../permissions';
import { endpoint } from './endpoint';

export const baseLevelSchema = z.enum(['owner', 'admin', 'user']);
export const localeSchema = z.enum(['en', 'ur']);

export const meResponse = z.object({
  user: z.object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    baseLevel: baseLevelSchema,
    locale: localeSchema,
  }),
  /** Effective permissions (Owner: the full catalogue). UI hides controls; the server enforces. */
  permissions: z.array(permissionKeySchema),
  /** Workspace feature flags (`ff_*`, 10 §2). Filled by T-101/T-102. */
  flags: z.record(z.string(), z.boolean()),
});
export type MeResponse = z.infer<typeof meResponse>;

export const usersEndpoints = {
  /** GET /api/v1/me: the current actor (401 when not signed in). */
  me: endpoint({ method: 'GET', path: '/api/v1/me', response: meResponse }),
} as const;
