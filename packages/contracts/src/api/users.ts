// Users / me contracts (docs/11-api.md "Auth & session", "Users, roles, teams"). Owner: Lane B.
// WORKED EXAMPLE of the endpoint pattern (13 §4 "How to add an endpoint in 5 steps").
import { z } from 'zod';
import { permissionKeySchema } from '../permissions';
import { endpoint } from './endpoint';

export const baseLevelSchema = z.enum(['owner', 'admin', 'user']);
export const localeSchema = z.enum(['en', 'ur']);
export const availabilitySchema = z.enum(['available', 'busy', 'on_leave', 'offline']);
export type BaseLevelDto = z.infer<typeof baseLevelSchema>;
export type Availability = z.infer<typeof availabilitySchema>;

export const meResponse = z.object({
  user: z.object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    baseLevel: baseLevelSchema,
    locale: localeSchema,
    // T-101 (additive): profile for the shell's user menu.
    name: z.string(),
    email: z.email(),
    timezone: z.string(),
    availability: availabilitySchema,
  }),
  // T-101 (additive): the workspace the session belongs to (one workspace per user, ADR-0004).
  workspace: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    currency: z.string().length(3),
    defaultLocale: localeSchema,
    demoMode: z.boolean(),
  }),
  /** Effective permissions (Owner: the full catalogue). UI hides controls; the server enforces. */
  permissions: z.array(permissionKeySchema),
  /** Workspace feature flags (`ff_*` keys of workspaces.settings, 10 §2). */
  flags: z.record(z.string(), z.boolean()),
});
export type MeResponse = z.infer<typeof meResponse>;

// ── Sessions (F1.8) ─────────────────────────────────────────────────────
export const sessionSummary = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  lastSeenAt: z.iso.datetime({ offset: true }),
  /** Absolute expiry (30 days after sign-in). Idle expiry is 7 days after lastSeenAt. */
  expiresAt: z.iso.datetime({ offset: true }),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** True for the session making this request. */
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummary>;
export const sessionsResponse = z.object({ items: z.array(sessionSummary) });
export const idParams = z.object({ id: z.uuid() });

// ── Users (F1.2, F1.8) ──────────────────────────────────────────────────
export const userSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  baseLevel: baseLevelSchema,
  availability: availabilitySchema,
  isActive: z.boolean(),
  locale: localeSchema,
  roles: z.array(z.object({ id: z.uuid(), name: z.string() })),
  version: z.number().int(),
  /** Open (unacknowledged + active) leads owned right now; 0 until the lead engine reports (T-103). */
  openLoad: z.number().int().nonnegative().optional(),
});
export type UserSummary = z.infer<typeof userSummary>;

export const usersListQuery = z
  .object({
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export const usersListResponse = z.object({ items: z.array(userSummary), nextCursor: z.uuid().nullable() });

export const usersEndpoints = {
  /** GET /api/v1/me: the current actor (401 when not signed in). */
  me: endpoint({ method: 'GET', path: '/api/v1/me', response: meResponse }),
  /** GET /api/v1/me/sessions: own active sessions (F1.8). */
  mySessions: endpoint({ method: 'GET', path: '/api/v1/me/sessions', response: sessionsResponse }),
  /** DELETE /api/v1/me/sessions/:id: end one of your own sessions (404 if not yours). 204. */
  revokeMySession: endpoint({
    method: 'DELETE',
    path: '/api/v1/me/sessions/:id',
    params: idParams,
    response: z.undefined(),
  }),
  /** GET /api/v1/users: workspace users (perm users.manage), keyset-paginated. */
  list: endpoint({
    method: 'GET',
    path: '/api/v1/users',
    query: usersListQuery,
    response: usersListResponse,
  }),
  /** GET /api/v1/users/:id: one user (perm users.manage; other workspaces' ids → 404). */
  get: endpoint({ method: 'GET', path: '/api/v1/users/:id', params: idParams, response: userSummary }),
} as const;
