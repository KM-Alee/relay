// Due-work processor registry: runDueWork() runs these IN ORDER each round (01 §6). ONE line each.
// Lead timers go first so the outbox rows their transitions enqueue are delivered in the same tick.
// Contract + rules: ./due-work.ts.
import type { DueWorkProcessor } from './due-work';
import { maintenanceProcessor } from './maintenance';
import { outboxProcessor } from './outbox-processor';

export const dueWorkProcessors: readonly DueWorkProcessor[] = [
  // leadTimersProcessor, // A · W2 (T-124/T-125/T-224): escalate_at, routing_retry_at, idle_check_at
  outboxProcessor, // A · T-008
  maintenanceProcessor, // A · T-008: retention pruning (outbox, job_runs, rate_limits)
];

if (new Set(dueWorkProcessors.map((p) => p.name)).size !== dueWorkProcessors.length) {
  throw new Error('duplicate due-work processor name in core/jobs/processors.ts');
}
