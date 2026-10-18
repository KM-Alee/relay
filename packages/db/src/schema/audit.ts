// Schema: audit domain (docs/02-data-model.md §9, docs/06-security.md §6). Owner: Lane B.
// Migration: 202610181301_b_audit_events.sql. Append-only: app_user has SELECT + INSERT only; seq,
// prev_hash, hash (and occurred_at by default) are set by the BEFORE INSERT trigger `audit_chain`.
// Insert through core/audit `audit.append(tx, …)`, never with a raw Drizzle insert.
import {
  bigint,
  bigserial,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea } from './columns';
import { workspaces } from './workspaces';

export const auditActorType = pgEnum('audit_actor_type', ['user', 'system', 'ai']);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    actorType: auditActorType('actor_type').notNull(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    meta: jsonb('meta'),
    prevHash: bytea('prev_hash').notNull(),
    hash: bytea('hash').notNull(),
  },
  (t) => [unique('audit_events_ws_seq_key').on(t.workspaceId, t.seq)],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
