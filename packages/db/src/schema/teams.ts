// Schema: teams domain (docs/02-data-model.md §2). Owner: Lane A.
// SQL source of truth: migrations/202610181410_a_teams_leads.sql (RLS, FKs, checks).
import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const escalationPolicies = pgTable('escalation_policies', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  repeatCount: integer('repeat_count').notNull().default(1),
  version: integer('version').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const escalationLevels = pgTable('escalation_levels', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  policyId: uuid('policy_id').notNull(),
  position: integer('position').notNull(),
  targetType: text('target_type')
    .$type<'next_eligible' | 'user' | 'team_backup' | 'team_manager'>()
    .notNull(),
  targetUserId: uuid('target_user_id'),
  timeoutSeconds: integer('timeout_seconds').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  managerUserId: uuid('manager_user_id'),
  backupUserId: uuid('backup_user_id'),
  routingMode: text('routing_mode')
    .$type<'round_robin' | 'first_to_claim'>()
    .notNull()
    .default('round_robin'),
  rrCursor: integer('rr_cursor').notNull().default(0),
  defaultCapacity: integer('default_capacity').notNull().default(5),
  skillsRouting: boolean('skills_routing').notNull().default(false),
  ackWindowSeconds: integer('ack_window_seconds').notNull().default(120),
  urgentAckWindowSeconds: integer('urgent_ack_window_seconds').notNull().default(45),
  routingRetrySeconds: integer('routing_retry_seconds').notNull().default(30),
  idleSeconds: integer('idle_seconds').notNull().default(600),
  idleRetriggerEnabled: boolean('idle_retrigger_enabled').notNull().default(false),
  escalationPolicyId: uuid('escalation_policy_id').notNull(),
  version: integer('version').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    workspaceId: uuid('workspace_id').notNull(),
    teamId: uuid('team_id').notNull(),
    userId: uuid('user_id').notNull(),
    position: integer('position').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const leadSources = pgTable('lead_sources', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  kind: text('kind').$type<'web_form' | 'whatsapp' | 'manual'>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const webForms = pgTable('web_forms', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  slug: text('slug').notNull().unique('web_forms_slug_key'),
  title: text('title').notNull(),
  teamId: uuid('team_id').notNull(),
  pipelineId: uuid('pipeline_id'),
  fieldIds: uuid('field_ids').array().notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  successMessageKey: text('success_message_key'),
  version: integer('version').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
