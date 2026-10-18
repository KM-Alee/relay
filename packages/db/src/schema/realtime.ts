// Schema: realtime domain (docs/02-data-model.md). Owner: Lane C.
// Only realtime tables here; migrations in packages/db/migrations (`pnpm db:new c <slug>`).
// realtime_events: hints only ({topic, ids}), see 202610181301_c_realtime_events.sql.
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const realtimeEvents = pgTable(
  'realtime_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id'),
    topic: text('topic').notNull(),
    ids: uuid('ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    index('realtime_events_workspace_at_idx').on(t.workspaceId, t.occurredAt),
    index('realtime_events_at_idx').on(t.occurredAt),
  ],
);
