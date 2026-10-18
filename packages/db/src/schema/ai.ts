// Schema: ai domain (docs/02-data-model.md). Owner: Lane C.
// ai_usage: one row per AI call (202610181302_c2_ai_usage.sql).
import { sql } from 'drizzle-orm';
import { bigint, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    task: text('task').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    status: text('status').notNull(),
    inTokens: integer('in_tokens').notNull().default(0),
    outTokens: integer('out_tokens').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [index('ai_usage_workspace_day_idx').on(t.workspaceId, t.createdAt)],
);
