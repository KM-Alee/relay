// Team administration contracts: invites, roles, level defaults, overrides, user lifecycle (docs/11-api.md
// "Users, roles, teams"). Owner: Lane B (T-103/T-104/T-105). Called through api.users.* (same domain).
import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth';
import { endpoint } from './endpoint';
import { idParams, localeSchema, meResponse, userSummary } from './users';
import { permissionKeySchema } from '../permissions';

// ── Invites (F1.2) ──────────────────────────────────────────────────────
export const inviteStatusSchema = z.enum(['pending', 'used', 'expired', 'revoked']);
export const inviteLevelSchema = z.enum(['admin', 'user']);

export const inviteSummary = z.object({
  id: z.uuid(),
  baseLevel: inviteLevelSchema,
  roleId: z.uuid().nullable(),
  roleName: z.string().nullable(),
  status: inviteStatusSchema,
  createdBy: z.uuid(),
  createdByName: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  usedByName: z.string().nullable(),
});
export type InviteSummary = z.infer<typeof inviteSummary>;

export const createInviteBody = z
  .object({ baseLevel: inviteLevelSchema.default('user'), roleId: z.uuid().nullish() })
  .strict();
/** The link is returned ONCE, at creation (only a hash is stored). */
export const createInviteResponse = z.object({ invite: inviteSummary, link: z.string().url() });
export const invitesListResponse = z.object({ items: z.array(inviteSummary) });

export const inviteTokenBody = z.object({ token: z.string().min(20).max(128) }).strict();
export const invitePreviewResponse = z.object({
  workspaceName: z.string(),
  baseLevel: inviteLevelSchema,
  roleName: z.string().nullable(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const acceptInviteBody = z
  .object({
    token: z.string().min(20).max(128),
    name: z.string().trim().min(1).max(80),
    email: emailSchema,
    password: passwordSchema,
    locale: localeSchema.optional(),
  })
  .strict();

// ── Roles & level defaults (F1.3, F1.7) ─────────────────────────────────
export const roleSummary = z.object({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  permissions: z.array(permissionKeySchema),
  memberCount: z.number().int().nonnegative(),
  version: z.number().int(),
});
export type RoleSummary = z.infer<typeof roleSummary>;
export const rolesListResponse = z.object({ items: z.array(roleSummary) });

const roleName = z.string().trim().min(1).max(60);
const permissionList = z.array(permissionKeySchema).max(100);
export const createRoleBody = z.object({ name: roleName, permissions: permissionList.default([]) }).strict();
export const updateRoleBody = z
  .object({ name: roleName.optional(), permissions: permissionList.optional(), version: z.number().int() })
  .strict();

export const levelPermissionsEntry = z.object({
  baseLevel: inviteLevelSchema,
  permissions: z.array(permissionKeySchema),
  version: z.number().int(),
});
export const levelPermissionsResponse = z.object({ items: z.array(levelPermissionsEntry) });
export const levelParams = z.object({ level: inviteLevelSchema });
export const updateLevelPermissionsBody = z
  .object({ permissions: permissionList, version: z.number().int() })
  .strict();

export const permissionOverride = z.object({
  permission: permissionKeySchema,
  effect: z.enum(['grant', 'deny']),
});
export const overridesResponse = z.object({
  items: z.array(permissionOverride),
  /** What the user can actually do right now (levels ∪ roles, overrides applied). */
  effective: z.array(permissionKeySchema),
});
export const setOverridesBody = z.object({ items: z.array(permissionOverride).max(100) }).strict();

// ── User lifecycle (F1.8) ───────────────────────────────────────────────
export const updateUserBody = z
  .object({
    version: z.number().int(),
    baseLevel: inviteLevelSchema.optional(),
    roleIds: z.array(z.uuid()).max(20).optional(),
  })
  .strict();
export const deactivateUserBody = z.object({ version: z.number().int().optional() }).strict();
export const endSessionsResponse = z.object({ revoked: z.number().int().nonnegative() });

export const teamAdminEndpoints = {
  invites: endpoint({ method: 'GET', path: '/api/v1/invites', response: invitesListResponse }),
  createInvite: endpoint({
    method: 'POST',
    path: '/api/v1/invites',
    body: createInviteBody,
    response: createInviteResponse,
  }),
  revokeInvite: endpoint({
    method: 'DELETE',
    path: '/api/v1/invites/:id',
    params: idParams,
    response: z.undefined(),
  }),
  previewInvite: endpoint({
    method: 'POST',
    path: '/api/v1/invites/preview',
    body: inviteTokenBody,
    response: invitePreviewResponse,
  }),
  acceptInvite: endpoint({
    method: 'POST',
    path: '/api/v1/invites/accept',
    body: acceptInviteBody,
    response: meResponse,
  }),
  roles: endpoint({ method: 'GET', path: '/api/v1/roles', response: rolesListResponse }),
  createRole: endpoint({
    method: 'POST',
    path: '/api/v1/roles',
    body: createRoleBody,
    response: roleSummary,
  }),
  updateRole: endpoint({
    method: 'PATCH',
    path: '/api/v1/roles/:id',
    params: idParams,
    body: updateRoleBody,
    response: roleSummary,
  }),
  deleteRole: endpoint({
    method: 'DELETE',
    path: '/api/v1/roles/:id',
    params: idParams,
    response: z.undefined(),
  }),
  levelPermissions: endpoint({
    method: 'GET',
    path: '/api/v1/level-permissions',
    response: levelPermissionsResponse,
  }),
  updateLevelPermissions: endpoint({
    method: 'PUT',
    path: '/api/v1/level-permissions/:level',
    params: levelParams,
    body: updateLevelPermissionsBody,
    response: levelPermissionsEntry,
  }),
  overrides: endpoint({
    method: 'GET',
    path: '/api/v1/users/:id/permission-overrides',
    params: idParams,
    response: overridesResponse,
  }),
  setOverrides: endpoint({
    method: 'PUT',
    path: '/api/v1/users/:id/permission-overrides',
    params: idParams,
    body: setOverridesBody,
    response: overridesResponse,
  }),
  updateUser: endpoint({
    method: 'PATCH',
    path: '/api/v1/users/:id',
    params: idParams,
    body: updateUserBody,
    response: userSummary,
  }),
  deactivateUser: endpoint({
    method: 'POST',
    path: '/api/v1/users/:id/deactivate',
    params: idParams,
    body: deactivateUserBody,
    response: userSummary,
  }),
  endUserSessions: endpoint({
    method: 'DELETE',
    path: '/api/v1/users/:id/sessions',
    params: idParams,
    response: endSessionsResponse,
  }),
} as const;
