// Schema: leads domain (docs/02-data-model.md §4, docs/03-lead-engine.md). Owner: Lane A.
// SQL source of truth: migrations/202610181410_a_teams_leads.sql (owner NOT NULL, checks, timer indexes).
// Runtime writes go through core/services/leads (one tx, FOR UPDATE, version check); never update directly.
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from './columns';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  contactId: uuid('contact_id'),
  opportunityId: uuid('opportunity_id'),
  teamId: uuid('team_id').notNull(),
  pipelineId: uuid('pipeline_id'),
  contactName: text('contact_name').notNull(),
  contactPhone: text('contact_phone'),
  contactEmail: citext('contact_email'),
  message: text('message'),
  sourceKind: text('source_kind').$type<'web_form' | 'whatsapp' | 'manual'>().notNull(),
  sourceId: uuid('source_id'),
  sourceLabel: text('source_label').notNull(),
  status: text('status').$type<'open' | 'closed'>().notNull().default('open'),
  closedReason: text('closed_reason'),
  ownerUserId: uuid('owner_user_id').notNull(),
  custody: text('custody').$type<'handler' | 'fallback'>().notNull(),
  awaitingHandler: boolean('awaiting_handler').notNull().default(false),
  awaitingReason: text('awaiting_reason'),
  ackStatus: text('ack_status').$type<'pending' | 'acknowledged'>().notNull().default('pending'),
  acknowledgedAt: ts('acknowledged_at'),
  acknowledgedVia: text('acknowledged_via'),
  firstAssignedAt: ts('first_assigned_at').notNull(),
  assignedAt: ts('assigned_at').notNull(),
  firstAcknowledgedAt: ts('first_acknowledged_at'),
  lastHumanActionAt: ts('last_human_action_at'),
  isUrgent: boolean('is_urgent').notNull().default(false),
  urgentSource: text('urgent_source'),
  isCritical: boolean('is_critical').notNull().default(false),
  escalationLevel: integer('escalation_level').notNull().default(1),
  escalationCycle: integer('escalation_cycle').notNull().default(0),
  escalationCount: integer('escalation_count').notNull().default(0),
  idleRetriggerCount: integer('idle_retrigger_count').notNull().default(0),
  overdueAttemptCount: integer('overdue_attempt_count').notNull().default(0),
  ackWindowEndsAt: ts('ack_window_ends_at'),
  escalateAt: ts('escalate_at'),
  routingRetryAt: ts('routing_retry_at'),
  idleCheckAt: ts('idle_check_at'),
  baseWindowEndsAt: ts('base_window_ends_at').notNull(),
  aiActive: boolean('ai_active').notNull().default(false),
  aiStartedAt: ts('ai_started_at'),
  aiHandoffAt: ts('ai_handoff_at'),
  /** Latest AI handoff brief (display data, migration 202610181500). Never an engine column. */
  aiBrief: jsonb('ai_brief').$type<Record<string, unknown>>(),
  aiBriefAt: ts('ai_brief_at'),
  version: integer('version').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export type LeadRow = typeof leads.$inferSelect;

export const leadEvents = pgTable('lead_events', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  type: text('type').notNull(),
  fromUserId: uuid('from_user_id'),
  toUserId: uuid('to_user_id'),
  custody: text('custody'),
  escalationLevel: integer('escalation_level'),
  trace: jsonb('trace'),
  meta: jsonb('meta'),
  actorType: text('actor_type').$type<'user' | 'system' | 'ai'>().notNull(),
  actorUserId: uuid('actor_user_id'),
  occurredAt: ts('occurred_at').notNull(),
});
export type LeadEventRow = typeof leadEvents.$inferSelect;
