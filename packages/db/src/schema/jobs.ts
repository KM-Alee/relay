// Schema: jobs domain: outbox, scheduler_state, job_runs (docs/02-data-model.md §8, 01 §6). Owner: Lane A (T-008).
// SQL source of truth: migrations/202610181301_a_jobs.sql (RLS on outbox, runner SECURITY DEFINER fns).
import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

export const OUTBOX_STATUSES = ['pending', 'in_flight', 'done', 'failed', 'dead'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Who ran a tick (job_runs.trigger). `manual` = Bearer CRON_SECRET (operator curl). */
export const TICK_TRIGGERS = ['qstash', 'cron', 'after', 'nudge', 'dev', 'judge', 'manual'] as const;
export type TickTrigger = (typeof TICK_TRIGGERS)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL = system job (no tenant), visible only in withSystemTx. */
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').$type<OutboxStatus>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(6),
    availableAt: ts('available_at').notNull().defaultNow(),
    lockedUntil: ts('locked_until'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key').unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    doneAt: ts('done_at'),
  },
  (t) => [
    check('outbox_status_check', sql`${t.status} in ('pending', 'in_flight', 'done', 'failed', 'dead')`),
  ],
);

export const schedulerState = pgTable('scheduler_state', {
  id: boolean('id').primaryKey().default(true),
  nextWakeAt: ts('next_wake_at'),
  qstashMessageId: text('qstash_message_id'),
  lastMaintenanceAt: ts('last_maintenance_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const jobRuns = pgTable('job_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  trigger: text('trigger').$type<TickTrigger>().notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  durationMs: integer('duration_ms'),
  budgetMs: integer('budget_ms').notNull(),
  leadsProcessed: integer('leads_processed').notNull().default(0),
  outboxProcessed: integer('outbox_processed').notNull().default(0),
  details: jsonb('details').notNull().default({}),
  nextWakeAt: ts('next_wake_at'),
  error: text('error'),
});

export type OutboxRow = typeof outbox.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
