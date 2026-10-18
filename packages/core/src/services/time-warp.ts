// Time-warp (F10.2, docs/01 §7). Owner: Lane A (T-210). The workspace multiplier scales every business
// DURATION through clock.deadline(). Changing it proportionally reschedules the pending deadlines of open
// leads in ONE tx so a running demo speeds up (or slows down) immediately. DEMO_MODE workspaces only.
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import { sql, type SQL } from 'drizzle-orm';
import { append as auditAppend } from '../audit/index';
import type { Actor } from '../auth/actor';
import { assertPermission } from '../auth/permissions';
import { AppError, notFound } from '../errors';
import { ensureWakeBy } from '../jobs/scheduler';
import { emit } from '../realtime/index';
import { dbNow } from './lead-engine';

export async function get(actor: Actor, opts: TxOptions = {}) {
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const r = (
        await tx.execute<{ m: string; demo: boolean }>(
          sql`select time_warp_multiplier::text as m, demo_mode as demo from workspaces where id = ${actor.workspaceId}`,
        )
      ).rows[0];
      if (!r) throw notFound();
      return { multiplier: Number(r.m), demoMode: r.demo };
    },
    opts,
  );
}

/** now + (col - now) * ratio for a future deadline; past/NULL values stay untouched. */
const scaled = (col: string, now: Date, ratio: number): SQL => {
  const c = sql.raw(col);
  const n = sql`${now.toISOString()}::timestamptz`;
  return sql`case when ${c} is null or ${c} <= ${n} then ${c} else ${n} + (${c} - ${n}) * ${ratio}::float8 end`;
};

export async function set(actor: Actor, multiplier: number, opts: TxOptions = {}) {
  assertPermission(actor, 'workspace.settings');
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const r = (
        await tx.execute<{ m: string; demo: boolean }>(
          sql`select time_warp_multiplier::text as m, demo_mode as demo from workspaces
               where id = ${actor.workspaceId} for update`,
        )
      ).rows[0];
      if (!r) throw notFound();
      if (!r.demo)
        throw new AppError('BUSINESS_RULE_VIOLATION', { details: { reason: 'time_warp_demo_only' } });
      const old = Number(r.m);
      let rescheduled = 0;
      if (old !== multiplier) {
        const now = await dbNow(tx);
        const ratio = old / multiplier; // remaining effective time scales by old/new
        await tx.execute(
          sql`update workspaces set time_warp_multiplier = ${multiplier} where id = ${actor.workspaceId}`,
        );
        const res = await tx.execute<{ id: string }>(sql`
          update leads set
            escalate_at = ${scaled('escalate_at', now, ratio)},
            ack_window_ends_at = ${scaled('ack_window_ends_at', now, ratio)},
            routing_retry_at = ${scaled('routing_retry_at', now, ratio)},
            idle_check_at = ${scaled('idle_check_at', now, ratio)},
            version = version + 1
          where status = 'open'
            and (escalate_at is not null or routing_retry_at is not null or idle_check_at is not null)
          returning id`);
        rescheduled = res.rows.length;
        const next = (
          await tx.execute<{ at: Date | string | null }>(sql`
            select min(least(escalate_at, routing_retry_at, idle_check_at)) as at
              from leads where status = 'open'`)
        ).rows[0]?.at;
        if (next) await ensureWakeBy(tx, new Date(next));
        await auditAppend(tx, actor, {
          action: 'workspace.time_warp_changed',
          targetType: 'workspace',
          targetId: actor.workspaceId,
          before: { multiplier: old },
          after: { multiplier },
          meta: { rescheduledLeads: rescheduled },
        });
        await emit(tx, {
          workspaceId: actor.workspaceId,
          topic: 'leads',
          ids: res.rows.slice(0, 100).map((x) => x.id),
        });
        await emit(tx, { workspaceId: actor.workspaceId, topic: 'recovery' });
      }
      return { multiplier, demoMode: true, rescheduledLeads: rescheduled };
    },
    opts,
  );
}

export const timeWarpService = { get, set };
