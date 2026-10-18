// runDueWork(): the stateless, idempotent, concurrency-safe tick (docs/01-architecture.md §6, ADR-0002).
//
//   job_runs row (trigger, budget) ─► rounds: every processor's runBatch() until a round handles
//   nothing or the budget is spent ─► next deadline = min(processor.nextDueAt) ─► ONE QStash wake
//   (scheduleWake: only if earlier than the scheduled one) ─► job_runs row finished (counts, wake)
//
// Callers: /api/internal/tick (qstash | cron | manual), after() kicks (after), /api/v1/tick-nudge
// (nudge), scripts/dev-ticker.ts (dev), Judge Console (judge). Any subset may fail without losing
// correctness: Postgres owns the deadlines; this function only executes what is due.
import { withSystemTx } from '@relay/db';
import type { TickTrigger } from '@relay/db/schema';
import { systemClock, type Clock } from '../clock';
import { config } from '../config';
import { getWakeScheduler } from '../integrations/qstash';
import type { WakeScheduler } from '../integrations/qstash/types';
import { log } from '../log';
import * as jobRunsRepo from '../repos/job-runs';
import type { DueWorkContext, DueWorkProcessor, DueWorkScope } from './due-work';
import { errorText, DEFAULT_LEASE_SECONDS } from './policy';
import { dueWorkProcessors } from './processors';
import { jobRegistry, type JobRegistry } from './registry';
import { MIN_WAKE_LEAD_MS, scheduleWake, type WakeOutcome } from './scheduler';
// Lead-engine hooks must be live in every job path (ticker, QStash, after() kicks).
import '../services/register-hooks';

export const DEFAULT_BATCH_SIZE = 10;
/** After a processor error, don't wake again sooner than this (avoids a hot wake loop). */
export const ERROR_WAKE_DELAY_MS = 30_000;

export interface RunDueWorkOptions {
  trigger: TickTrigger;
  /** Default: TICK_BUDGET_MS (20 s). Soft: a claimed batch is always finished. */
  budgetMs?: number;
  batchSize?: number;
  leaseSeconds?: number;
  scope?: DueWorkScope;
  processors?: readonly DueWorkProcessor[];
  registry?: JobRegistry;
  /** null → don't schedule a wake (tests that don't own scheduler_state). Default: env selection. */
  scheduler?: WakeScheduler | null;
  clock?: Clock;
  random?: () => number;
}

export interface ProcessorReport {
  processed: number;
  error?: string;
}

export interface TickResult {
  runId: string;
  trigger: TickTrigger;
  budgetMs: number;
  durationMs: number;
  rounds: number;
  budgetExhausted: boolean;
  leadsProcessed: number;
  outboxProcessed: number;
  processors: Record<string, ProcessorReport>;
  nextDueAt: string | null;
  wake: { outcome: WakeOutcome | 'failed' | 'none'; at?: string; error?: string };
}

const minDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);

export async function runDueWork(opts: RunDueWorkOptions): Promise<TickResult> {
  const budgetMs = opts.budgetMs ?? config.jobs.TICK_BUDGET_MS;
  const clock = opts.clock ?? systemClock;
  const processors = opts.processors ?? dueWorkProcessors;
  const started = performance.now();
  const remainingMs = () => budgetMs - (performance.now() - started);

  const runId = await withSystemTx((tx) => jobRunsRepo.start(tx, opts.trigger, budgetMs));

  const ctx: DueWorkContext = {
    trigger: opts.trigger,
    clock,
    batchSize: opts.batchSize ?? DEFAULT_BATCH_SIZE,
    leaseSeconds: opts.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
    scope: opts.scope ?? {},
    registry: opts.registry ?? jobRegistry,
    random: opts.random ?? Math.random,
    remainingMs,
  };

  const reports: Record<string, ProcessorReport> = Object.fromEntries(
    processors.map((p) => [p.name, { processed: 0 }]),
  );
  let rounds = 0;
  let budgetExhausted = false;
  let anyError = false;

  // ── rounds ──
  for (;;) {
    let handled = 0;
    rounds += 1;
    for (const p of processors) {
      if (remainingMs() <= 0) {
        budgetExhausted = true;
        break;
      }
      try {
        const n = await p.runBatch(ctx);
        reports[p.name]!.processed += n;
        handled += n;
      } catch (err) {
        anyError = true;
        reports[p.name]!.error = errorText(err);
        log.error('jobs.processor_failed', { processor: p.name, trigger: opts.trigger, err });
      }
    }
    if (budgetExhausted || handled === 0) break;
    if (remainingMs() <= 0) {
      budgetExhausted = true;
      break;
    }
  }

  // ── next wake ──
  let nextDue: Date | null = null;
  for (const p of processors) {
    if (!p.nextDueAt) continue;
    try {
      nextDue = minDate(nextDue, await p.nextDueAt(ctx));
    } catch (err) {
      anyError = true;
      log.error('jobs.next_due_failed', { processor: p.name, err });
    }
  }

  let wake: TickResult['wake'] = { outcome: 'none' };
  const scheduler = opts.scheduler === undefined ? getWakeScheduler() : opts.scheduler;
  if (nextDue && scheduler) {
    const now = clock.now().getTime();
    // Something is due already: either the budget ran out (wake ASAP) or a processor failed
    // (back off so a broken dependency can't burn the QStash cap). Future: wake at the deadline.
    const floor = now + (anyError && !budgetExhausted ? ERROR_WAKE_DELAY_MS : MIN_WAKE_LEAD_MS + 500);
    const at = new Date(Math.max(nextDue.getTime(), floor));
    try {
      const r = await scheduleWake(at, { scheduler, clock });
      wake = { outcome: r.outcome, at: r.at.toISOString() };
    } catch (err) {
      wake = { outcome: 'failed', at: at.toISOString(), error: errorText(err) };
      log.warn('jobs.wake_failed', { err });
    }
  }

  const sum = (counter: 'leads' | 'outbox') =>
    processors.filter((p) => p.counter === counter).reduce((n, p) => n + reports[p.name]!.processed, 0);
  const result: TickResult = {
    runId,
    trigger: opts.trigger,
    budgetMs,
    durationMs: Math.round(performance.now() - started),
    rounds,
    budgetExhausted,
    leadsProcessed: sum('leads'),
    outboxProcessed: sum('outbox'),
    processors: reports,
    nextDueAt: nextDue?.toISOString() ?? null,
    wake,
  };

  const errors = Object.entries(reports)
    .filter(([, r]) => r.error)
    .map(([name, r]) => `${name}: ${r.error}`);
  try {
    await withSystemTx((tx) =>
      jobRunsRepo.finish(tx, runId, {
        durationMs: result.durationMs,
        leadsProcessed: result.leadsProcessed,
        outboxProcessed: result.outboxProcessed,
        details: { processors: reports, rounds, budgetExhausted, wake },
        nextWakeAt: wake.at ? new Date(wake.at) : null,
        error: errors.length ? errors.join(' | ').slice(0, 2000) : null,
      }),
    );
  } catch (err) {
    log.error('jobs.job_run_finish_failed', { runId, err });
  }
  return result;
}
