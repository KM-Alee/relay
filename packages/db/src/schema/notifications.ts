// Schema: notifications domain (docs/02-data-model.md §4). Owner: Lane A.
// SQL source of truth: migrations/202610181410_a_teams_leads.sql.
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  type: text('type').notNull(),
  leadId: uuid('lead_id'),
  params: jsonb('params').notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
