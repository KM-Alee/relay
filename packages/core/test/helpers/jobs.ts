// Integration helpers for jobs tests (real Postgres; code under test runs as app_user).
// Every test scopes runDueWork to its own workspace(s) so parallel test files never steal rows.
import { randomUUID } from 'node:crypto';
import { withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { withOwner } from '../../../db/test/helpers';
import { systemClock } from '../../src/clock';
import type { DueWorkContext } from '../../src/jobs/due-work';
import { DEFAULT_LEASE_SECONDS } from '../../src/jobs/policy';
import type { JobRegistry } from '../../src/jobs/registry';

export async function createWorkspace(): Promise<string> {
  const id = randomUUID();
  await withWorkspaceTx(id, (tx) =>
    tx.execute(sql`insert into workspaces (id, name, slug) values (${id}, 'jobs test', ${`jobs-${id}`})`),
  );
  return id;
}

/** Owner-connection query (fixtures, time travel, assertions that bypass RLS). */
export async function owner<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return withOwner(async (c) => (await c.query(text, params)).rows as T[]);
}

export interface OutboxSnapshot {
  id: string;
  workspace_id: string | null;
  type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  available_in_ms: number;
  locked_until: Date | null;
  done_at: Date | null;
  payload: unknown;
}

export async function outboxRows(workspaceId: string): Promise<OutboxSnapshot[]> {
  return owner<OutboxSnapshot>(
    `select id, workspace_id, type, status, attempts, max_attempts, last_error, locked_until, done_at, payload,
            (extract(epoch from (available_at - now())) * 1000)::int as available_in_ms
       from outbox where workspace_id = $1 order by created_at, id`,
    [workspaceId],
  );
}

/** Pretend the lease ran out (instead of sleeping 60 s). */
export async function expireLeases(workspaceId: string): Promise<void> {
  await owner(
    `update outbox set locked_until = now() - interval '1 second' where workspace_id = $1 and status = 'in_flight'`,
    [workspaceId],
  );
}

/** Make retry-scheduled rows due now (instead of waiting out the backoff). */
export async function makeDue(workspaceId: string): Promise<void> {
  await owner(`update outbox set available_at = now() where workspace_id = $1 and status = 'pending'`, [
    workspaceId,
  ]);
}

export function ctxFor(
  workspaceId: string,
  registry: JobRegistry,
  over: Partial<DueWorkContext> = {},
): DueWorkContext {
  return {
    trigger: 'dev',
    clock: systemClock,
    batchSize: 10,
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    scope: { workspaceIds: [workspaceId] },
    registry,
    random: () => 0.5,
    remainingMs: () => 10_000,
    ...over,
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
