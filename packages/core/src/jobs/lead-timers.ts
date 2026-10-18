// Lead timer due-work processor (docs/03-lead-engine.md §6; T3 escalation, T4 retry, T9 idle). Owner: Lane A.
// Claim candidate ids across workspaces (SECURITY DEFINER, FOR UPDATE SKIP LOCKED) and commit; then
// handle each in its own withWorkspaceTx: re-lock, re-check the guard, versioned update. Two racing
// ticks → one transition (F3.8); a crash before commit → redone exactly once by the next tick (Q5).
import { withSystemTx } from '@relay/db';
import { log } from '../log';
import * as leadsRepo from '../repos/leads';
import { processLeadTimer } from '../services/leads';
import { defineProcessor } from './due-work';

export const leadTimersProcessor = defineProcessor({
  name: 'lead_timers',
  counter: 'leads',
  async runBatch(ctx) {
    if (ctx.scope.types?.length) return 0; // outbox-only scoped runs
    const due = await withSystemTx((tx) =>
      leadsRepo.claimDueTimers(tx, ctx.batchSize, ctx.scope.workspaceIds),
    );
    let handled = 0;
    for (const d of due) {
      if (ctx.remainingMs() <= 0) break;
      try {
        if ((await processLeadTimer(d.workspaceId, d.id)) !== 'noop') handled++;
      } catch (err) {
        // A lost version race surfaces as STALE_VERSION: the other tick did the work.
        log.warn('jobs.lead_timer_failed', { leadId: d.id, err });
      }
    }
    return handled;
  },
  async nextDueAt(ctx) {
    return withSystemTx((tx) => leadsRepo.nextDueTimer(tx, ctx.scope.workspaceIds));
  },
});
