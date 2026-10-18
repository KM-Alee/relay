// workspaces (docs/02-data-model.md §1). RLS: `id = app.workspace_id` (migration 202610181210_w0_workspaces).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    // FK to users is added by the identity migration (T-101): users references workspaces.
    ownerUserId: uuid('owner_user_id'),
    defaultLocale: text('default_locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('Asia/Karachi'),
    currency: char('currency', { length: 3 }).notNull().default('PKR'),
    defaultLeadValueMinor: bigint('default_lead_value_minor', { mode: 'number' }),
    timeWarpMultiplier: numeric('time_warp_multiplier', { precision: 6, scale: 2 }).notNull().default('1'),
    demoMode: boolean('demo_mode').notNull().default(false),
    businessHours: jsonb('business_hours').notNull().default({}),
    settings: jsonb('settings').notNull().default({}),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('workspaces_default_locale_check', sql`${t.defaultLocale} in ('en', 'ur')`),
    check('workspaces_time_warp_multiplier_check', sql`${t.timeWarpMultiplier} > 0`),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
