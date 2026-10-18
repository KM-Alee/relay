// Due-work processor contract: the extension point of runDueWork() (01 §6). Owner: Lane A.
//
// A processor owns ONE kind of deadline column (outbox.available_at, leads.escalate_at, …). Each
// round, runDueWork() calls runBatch() on every processor in `processors.ts` order, until a whole
// round handles nothing or the budget is spent. Then it asks each processor for nextDueAt() and
// schedules ONE QStash wake for the earliest.
//
// Rules for runBatch (03 §6, 01 §6):
//   * claim ≤ ctx.batchSize due items with a SECURITY DEFINER claim fn (FOR UPDATE SKIP LOCKED);
//   * handle EACH item in its own short withWorkspaceTx: re-lock the row, re-check the guard,
//     conditional UPDATE … WHERE version = $v. A crash before commit rolls back → the next tick
//     redoes it exactly once (Q5); two ticks racing → one wins (F3.8);
//   * never hold a transaction open across an external call (outbox instead);
//   * return the number of items handled (0 = nothing due). Throwing marks the processor's error
//     in job_runs and does not stop the other processors.
//   * honour ctx.scope.workspaceIds when set (tests run in parallel and must not steal each
//     other's rows).
import type { TickTrigger } from '@relay/db/schema';
import type { Clock } from '../clock';
import type { JobRegistry } from './registry';

export interface DueWorkScope {
  /** Only these workspaces' rows (tests, Judge Console scenarios). NULL-workspace rows excluded. */
  workspaceIds?: readonly string[];
  /** Outbox only: only these job types. */
  types?: readonly string[];
}

export interface DueWorkContext {
  readonly trigger: TickTrigger;
  readonly clock: Clock;
  /** Max items to claim per runBatch call. */
  readonly batchSize: number;
  /** In-flight lease for claimed outbox rows (seconds). */
  readonly leaseSeconds: number;
  readonly scope: DueWorkScope;
  readonly registry: JobRegistry;
  /** [0,1) source for jitter (tests pin it). */
  readonly random: () => number;
  /** Milliseconds left in this tick's budget. Stop claiming when ≤ 0. */
  remainingMs(): number;
}

export interface DueWorkProcessor {
  /** Stable name used in job_runs.details (e.g. 'outbox', 'lead_timers'). */
  readonly name: string;
  /** Which job_runs counter its items add to. */
  readonly counter: 'leads' | 'outbox' | null;
  runBatch(ctx: DueWorkContext): Promise<number>;
  /** Earliest pending deadline this processor owns (drives the next QStash wake), or null. */
  nextDueAt?(ctx: DueWorkContext): Promise<Date | null>;
}

export const isScoped = (s: DueWorkScope) => Boolean(s.workspaceIds?.length || s.types?.length);

/** Typed identity helper: `export const leadTimersProcessor = defineProcessor({ … })`. */
export function defineProcessor(p: DueWorkProcessor): DueWorkProcessor {
  return p;
}
