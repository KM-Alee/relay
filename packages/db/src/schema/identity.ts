// Schema: identity domain (docs/02-data-model.md §1). Owner: Lane B.
// Migration: 202610181302_b_identity.sql (RLS on every table; SECURITY DEFINER auth_find_user_by_email,
// auth_resolve_session). Invites arrive with T-103.
import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, citext, inet } from './columns';
import { workspaces } from './workspaces';

export const userBaseLevel = pgEnum('user_base_level', ['owner', 'admin', 'user']);
export const userAvailability = pgEnum('user_availability', ['available', 'busy', 'on_leave', 'offline']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    email: citext('email').notNull().unique('users_email_key'),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    baseLevel: userBaseLevel('base_level').notNull(),
    availability: userAvailability('availability').notNull().default('available'),
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    locale: text('locale').$type<'en' | 'ur'>().notNull().default('en'),
    timezone: text('timezone').notNull().default('Asia/Karachi'),
    capacity: integer('capacity'),
    skills: text('skills')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    slackUserId: text('slack_user_id'),
    slackTeamId: text('slack_team_id'),
    uiPrefs: jsonb('ui_prefs').notNull().default({}),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('users_ws_id_key').on(t.workspaceId, t.id)],
);
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const levelPermissions = pgTable(
  'level_permissions',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    baseLevel: userBaseLevel('base_level').notNull(),
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.baseLevel] })],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    /** Stable key for seeded roles ('manager'); NULL for custom roles. */
    key: text('key'),
    name: text('name').notNull(),
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isSystem: boolean('is_system').notNull().default(false),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('roles_ws_id_key').on(t.workspaceId, t.id)],
);
export type Role = typeof roles.$inferSelect;

export const userRoles = pgTable(
  'user_roles',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [users.workspaceId, users.id] }),
    foreignKey({
      columns: [t.workspaceId, t.roleId],
      foreignColumns: [roles.workspaceId, roles.id],
    }).onDelete('cascade'),
  ],
);

export const userPermissionOverrides = pgTable(
  'user_permission_overrides',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id').notNull(),
    permission: text('permission').notNull(),
    effect: text('effect').$type<'grant' | 'deny'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.permission] }),
    foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [users.workspaceId, users.id] }),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id').notNull(),
    tokenHash: bytea('token_hash').notNull().unique('sessions_token_hash_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotateRequired: boolean('rotate_required').notNull().default(false),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    unique('sessions_ws_id_key').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.userId], foreignColumns: [users.workspaceId, users.id] }),
  ],
);
export type Session = typeof sessions.$inferSelect;
