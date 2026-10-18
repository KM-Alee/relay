// Schema: crm domain (docs/02-data-model.md §3). Owner: Lane B.
// Migration: 202610181303_b_crm.sql (RLS ENABLE+FORCE on every table, composite tenant FKs).
// Soft delete (deleted_at) for companies/contacts/opportunities; config tables are hard-deleted via safe flows.
import {
  bigint,
  boolean,
  char,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from './columns';
import { workspaces } from './workspaces';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const ws = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);
const stamps = () => ({
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export type FieldEntity = 'contact' | 'company' | 'opportunity';
export type FieldType = 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'ai';
export type StageKind = 'open' | 'won' | 'lost';
export type ActivityType =
  | 'note'
  | 'call'
  | 'stage_change'
  | 'assignment'
  | 'field_edit'
  | 'message_in'
  | 'message_out'
  | 'ai_message'
  | 'payment'
  | 'appointment'
  | 'import'
  | 'system';

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey(),
    workspaceId: ws(),
    name: text('name').notNull(),
    ownerUserId: uuid('owner_user_id'),
    deletedAt: ts('deleted_at'),
    version: integer('version').notNull().default(0),
    ...stamps(),
  },
  (t) => [unique('companies_ws_id_key').on(t.workspaceId, t.id)],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey(),
    workspaceId: ws(),
    companyId: uuid('company_id'),
    name: text('name').notNull(),
    phoneE164: text('phone_e164'),
    email: citext('email'),
    ownerUserId: uuid('owner_user_id'),
    language: text('language').$type<'en' | 'ur' | 'ur-Latn'>(),
    languageSource: text('language_source').$type<'detected' | 'manual'>().notNull().default('manual'),
    optedOut: boolean('opted_out').notNull().default(false),
    optedOutAt: ts('opted_out_at'),
    aiProfile: jsonb('ai_profile').notNull().default({}),
    lastActivityAt: ts('last_activity_at'),
    deletedAt: ts('deleted_at'),
    version: integer('version').notNull().default(0),
    ...stamps(),
  },
  (t) => [unique('contacts_ws_id_key').on(t.workspaceId, t.id)],
);

export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid('id').primaryKey(),
    workspaceId: ws(),
    name: text('name').notNull(),
    teamId: uuid('team_id'),
    position: integer('position').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    version: integer('version').notNull().default(0),
    ...stamps(),
  },
  (t) => [unique('pipelines_ws_id_key').on(t.workspaceId, t.id)],
);

export const stages = pgTable(
  'stages',
  {
    id: uuid('id').primaryKey(),
    workspaceId: ws(),
    pipelineId: uuid('pipeline_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    kind: text('kind').$type<StageKind>().notNull().default('open'),
    rotSeconds: integer('rot_seconds'),
    version: integer('version').notNull().default(0),
    ...stamps(),
  },
  (t) => [unique('stages_ws_id_key').on(t.workspaceId, t.id)],
);

export const customFields = pgTable(
  'custom_fields',
  {
    id: uuid('id').primaryKey(),
    workspaceId: ws(),
    entity: text('entity').$type<FieldEntity>().notNull(),
    pipelineId: uuid('pipeline_id'),
    key: text('key').notNull(),
    label: jsonb('label').$type<{ en: string; ur: string }>().notNull(),
    type: text('type').$type<FieldType>().notNull(),
    options: jsonb('options')
      .$type<{ value: string; label: { en: string; ur: string } }[]>()
      .notNull()
      .default([]),
    aiConfig: jsonb('ai_config'),
    position: integer('position').notNull().default(0),
    version: integer('version').notNull().default(0),
    ...stamps(),
  },
  (t) => [unique('custom_fields_ws_id_key').on(t.workspaceId, t.id)],
);

export const stageRequiredFields = pgTable(
  'stage_required_fields',
  {
    workspaceId: ws(),
    stageId: uuid('stage_id').notNull(),
    fieldId: uuid('field_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.stageId, t.fieldId] })],
);

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey(),
    workspaceId: ws(),
    contactId: uuid('contact_id').notNull(),
    pipelineId: uuid('pipeline_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    title: text('title').notNull(),
    valueMinor: bigint('value_minor', { mode: 'number' }),
    currency: char('currency', { length: 3 }).notNull().default('PKR'),
    ownerUserId: uuid('owner_user_id'),
    stageEnteredAt: ts('stage_entered_at').notNull().defaultNow(),
    lastActivityAt: ts('last_activity_at'),
    closedAt: ts('closed_at'),
    deletedAt: ts('deleted_at'),
    version: integer('version').notNull().default(0),
    ...stamps(),
  },
  (t) => [unique('opportunities_ws_id_key').on(t.workspaceId, t.id)],
);

export const fieldValues = pgTable('field_values', {
  id: uuid('id').primaryKey(),
  workspaceId: ws(),
  fieldId: uuid('field_id').notNull(),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  opportunityId: uuid('opportunity_id'),
  value: jsonb('value').notNull(),
  source: text('source').$type<'human' | 'ai' | 'import'>().notNull().default('human'),
  updatedBy: uuid('updated_by'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey(),
    workspaceId: ws(),
    name: text('name').notNull(),
    ...stamps(),
  },
  (t) => [unique('tags_ws_id_key').on(t.workspaceId, t.id)],
);

export const contactTags = pgTable(
  'contact_tags',
  { workspaceId: ws(), tagId: uuid('tag_id').notNull(), contactId: uuid('contact_id').notNull() },
  (t) => [primaryKey({ columns: [t.tagId, t.contactId] })],
);

export const opportunityTags = pgTable(
  'opportunity_tags',
  { workspaceId: ws(), tagId: uuid('tag_id').notNull(), opportunityId: uuid('opportunity_id').notNull() },
  (t) => [primaryKey({ columns: [t.tagId, t.opportunityId] })],
);

export const savedLists = pgTable(
  'saved_lists',
  {
    id: uuid('id').primaryKey(),
    workspaceId: ws(),
    ownerUserId: uuid('owner_user_id').notNull(),
    name: text('name').notNull(),
    entity: text('entity').$type<FieldEntity>().notNull(),
    criteria: jsonb('criteria').notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    needsReview: boolean('needs_review').notNull().default(false),
    version: integer('version').notNull().default(0),
    ...stamps(),
  },
  (t) => [unique('saved_lists_ws_id_key').on(t.workspaceId, t.id)],
);

export const activities = pgTable('activities', {
  id: uuid('id').primaryKey(),
  workspaceId: ws(),
  contactId: uuid('contact_id'),
  opportunityId: uuid('opportunity_id'),
  leadId: uuid('lead_id'),
  type: text('type').$type<ActivityType>().notNull(),
  actorType: text('actor_type').$type<'user' | 'system' | 'ai'>().notNull(),
  actorUserId: uuid('actor_user_id'),
  payload: jsonb('payload').notNull().default({}),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});
