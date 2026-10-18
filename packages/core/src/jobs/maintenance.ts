// Maintenance processor: housekeeping at most once per MAINTENANCE_INTERVAL_SECONDS across all
// instances (claimed via scheduler_state.last_maintenance_at). Never counts as "work", so it does
// not keep the tick loop spinning. Skipped for scoped runs (tests / Judge scenarios).
import { withSystemTx } from '@relay/db';
import { log } from '../log';
import * as jobRunsRepo from '../repos/job-runs';
import * as outboxRepo from '../repos/outbox';
import * as rateLimitsRepo from '../repos/rate-limits';
import { pruneRealtimeEvents } from '../realtime/index';
import * as stateRepo from '../repos/scheduler-state';
import { defineProcessor, isScoped } from './due-work';

export const MAINTENANCE_INTERVAL_SECONDS = 600;
const DAY = 86_400;
export const RETENTION = {
  outboxDoneSeconds: 7 * DAY,
  outboxDeadSeconds: 30 * DAY, // failed/dead rows stay visible to Admins longer
  jobRunsSeconds: 3 * DAY,
  rateLimitsSeconds: DAY, // 06 §1
} as const;

export const maintenanceProcessor = defineProcessor({
  name: 'maintenance',
  counter: null,
  async runBatch(ctx) {
    if (isScoped(ctx.scope)) return 0;
    const claimed = await withSystemTx((tx) => stateRepo.claimMaintenance(tx, MAINTENANCE_INTERVAL_SECONDS));
    if (!claimed) return 0;
    const pruned = await withSystemTx(async (tx) => ({
      outbox: await outboxRepo.prune(tx, RETENTION.outboxDoneSeconds, RETENTION.outboxDeadSeconds),
      jobRuns: await jobRunsRepo.prune(tx, RETENTION.jobRunsSeconds),
      rateLimits: await rateLimitsRepo.prune(tx, RETENTION.rateLimitsSeconds),
      realtimeEvents: await pruneRealtimeEvents(tx),
    }));
    log.info('jobs.maintenance', { pruned });
    return 0;
  },
});
