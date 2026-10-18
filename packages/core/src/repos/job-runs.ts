// job_runs data access: one row per tick (heartbeat for the Judge Console / integrations page).
// Global table (no RLS); always used from withSystemTx.
import type { Tx } from '@relay/db';
import type { TickTrigger } from '@relay/db/schema';
import { sql } from 'drizzle-orm';

export async function start(tx: Tx, trigger: TickTrigger, budgetMs: number): Promise<string> {
  const res = await tx.execute<{ id: string }>(
    sql`insert into job_runs (trigger, budget_ms) values (${trigger}, ${budgetMs}) returning id`,
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error('job_runs insert returned no row');
  return id;
}

export interface FinishRun {
  durationMs: number;
  leadsProcessed: number;
  outboxProcessed: number;
  details: Record<string, unknown>;
  nextWakeAt: Date | null;
  error: string | null;
}

export async function finish(tx: Tx, id: string, f: FinishRun): Promise<void> {
  await tx.execute(sql`
    update job_runs
       set finished_at = now(), duration_ms = ${f.durationMs}, leads_processed = ${f.leadsProcessed},
           outbox_processed = ${f.outboxProcessed}, details = ${JSON.stringify(f.details)}::jsonb,
           next_wake_at = ${f.nextWakeAt}::timestamptz, error = ${f.error}
     where id = ${id}
  `);
}

export async function prune(tx: Tx, olderThanSeconds: number): Promise<number> {
  const res = await tx.execute(
    sql`delete from job_runs where started_at < now() - make_interval(secs => ${olderThanSeconds})`,
  );
  return res.rowCount ?? 0;
}

export interface JobRunRow {
  id: string;
  trigger: TickTrigger;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  budgetMs: number;
  leadsProcessed: number;
  outboxProcessed: number;
  details: Record<string, unknown>;
  nextWakeAt: Date | null;
  error: string | null;
}

const date = (v: Date | string | null) => (v === null ? null : new Date(v));

export async function latest(tx: Tx, limit = 20): Promise<JobRunRow[]> {
  const res = await tx.execute<{
    id: string;
    trigger: TickTrigger;
    started_at: Date | string;
    finished_at: Date | string | null;
    duration_ms: number | null;
    budget_ms: number;
    leads_processed: number;
    outbox_processed: number;
    details: Record<string, unknown>;
    next_wake_at: Date | string | null;
    error: string | null;
  }>(sql`select * from job_runs order by started_at desc limit ${limit}`);
  return res.rows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    startedAt: new Date(r.started_at),
    finishedAt: date(r.finished_at),
    durationMs: r.duration_ms,
    budgetMs: r.budget_ms,
    leadsProcessed: r.leads_processed,
    outboxProcessed: r.outbox_processed,
    details: r.details,
    nextWakeAt: date(r.next_wake_at),
    error: r.error,
  }));
}
