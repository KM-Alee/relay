// Recovery queue (docs/03-lead-engine.md §7, F3.7): the SINGLE SQL definition of R1–R5, used by the
// Recovery page AND the Overview figure (repos/metrics.ts), so the figure always equals the list count.
// Pure mirror for tests: core/domain/leads/recovery.ts (classifyRecovery). Owner: Lane A.
import type { Tx } from '@relay/db';
import { sql, type SQL } from 'drizzle-orm';

export type RecoveryReasonKey = 'overdue' | 'escalated2' | 'idle' | 'awaiting' | 'critical';
export const RECOVERY_REASONS: readonly RecoveryReasonKey[] = [
  'overdue',
  'escalated2',
  'idle',
  'awaiting',
  'critical',
];

/**
 * The FROM clause every recovery query uses: `l` = leads, `t` = its team (idle seconds), `w` = the
 * workspace (time-warp multiplier: idle periods scale like every other business duration).
 */
export const RECOVERY_FROM = sql`leads l join teams t on t.id = l.team_id join workspaces w on w.id = l.workspace_id`;

/** Per-reason predicates (each criterion independently active, F3.7). */
export const RECOVERY_PREDICATE: Record<RecoveryReasonKey, SQL> = {
  overdue: sql`(l.ack_status = 'pending' and now() > l.base_window_ends_at)`,
  escalated2: sql`(l.escalation_count >= 2)`,
  idle: sql`(coalesce(l.last_human_action_at, l.acknowledged_at, l.first_assigned_at)
              < now() - make_interval(secs => t.idle_seconds / greatest(w.time_warp_multiplier, 0.0001)))`,
  awaiting: sql`(l.awaiting_handler)`,
  critical: sql`(l.is_critical)`,
};

/** `l.status='open' AND (R1 OR … OR R5)`, optionally restricted to one reason. */
export function recoveryWhere(reason?: RecoveryReasonKey): SQL {
  const any = reason
    ? RECOVERY_PREDICATE[reason]
    : sql.join(
        RECOVERY_REASONS.map((r) => RECOVERY_PREDICATE[r]),
        sql` or `,
      );
  return sql`l.status = 'open' and (${any})`;
}

export interface RecoveryRow {
  id: string;
  teamId: string;
  contactId: string | null;
  contactName: string;
  sourceLabel: string;
  ownerUserId: string;
  ownerName: string;
  custody: 'handler' | 'fallback';
  awaitingReason: string | null;
  ackStatus: 'pending' | 'acknowledged';
  isUrgent: boolean;
  isCritical: boolean;
  escalationCount: number;
  overdueAttemptCount: number;
  baseWindowEndsAt: Date;
  firstAssignedAt: Date;
  lastActionAt: Date;
  version: number;
  reasons: RecoveryReasonKey[];
}

/** The queue, sorted: critical, then urgent, then oldest first_assigned_at (03 §7). */
export async function listRecovery(
  tx: Tx,
  o: { scope: SQL; reason?: RecoveryReasonKey; ownerUserId?: string; limit: number },
): Promise<RecoveryRow[]> {
  const flag = (k: RecoveryReasonKey) => sql`${RECOVERY_PREDICATE[k]} as ${sql.raw(`r_${k}`)}`;
  const res = await tx.execute<Record<string, unknown>>(sql`
    select l.id, l.team_id, l.contact_id, l.contact_name, l.source_label, l.owner_user_id, u.name as owner_name,
           l.custody, l.awaiting_reason, l.ack_status, l.is_urgent, l.is_critical, l.escalation_count,
           l.overdue_attempt_count, l.base_window_ends_at, l.first_assigned_at, l.version,
           coalesce(l.last_human_action_at, l.acknowledged_at, l.first_assigned_at) as last_action_at,
           ${sql.join(RECOVERY_REASONS.map(flag), sql`, `)}
      from ${RECOVERY_FROM} join users u on u.id = l.owner_user_id
     where ${recoveryWhere(o.reason)} and ${o.scope}
       ${o.ownerUserId ? sql`and l.owner_user_id = ${o.ownerUserId}::uuid` : sql``}
     order by l.is_critical desc, l.is_urgent desc, l.first_assigned_at asc, l.id
     limit ${o.limit}`);
  const d = (v: unknown) => new Date(v as string);
  return res.rows.map((r) => ({
    id: r.id as string,
    teamId: r.team_id as string,
    contactId: (r.contact_id as string | null) ?? null,
    contactName: r.contact_name as string,
    sourceLabel: r.source_label as string,
    ownerUserId: r.owner_user_id as string,
    ownerName: r.owner_name as string,
    custody: r.custody as RecoveryRow['custody'],
    awaitingReason: (r.awaiting_reason as string | null) ?? null,
    ackStatus: r.ack_status as RecoveryRow['ackStatus'],
    isUrgent: !!r.is_urgent,
    isCritical: !!r.is_critical,
    escalationCount: Number(r.escalation_count),
    overdueAttemptCount: Number(r.overdue_attempt_count),
    baseWindowEndsAt: d(r.base_window_ends_at),
    firstAssignedAt: d(r.first_assigned_at),
    lastActionAt: d(r.last_action_at),
    version: Number(r.version),
    reasons: RECOVERY_REASONS.filter((k) => r[`r_${k}`] === true),
  }));
}

/** Count of the same definition (Overview KPI = list length, F5.1 drill-down). */
export async function countRecovery(tx: Tx, scope: SQL): Promise<{ count: number; critical: number }> {
  const res = await tx.execute<{ n: string; c: string }>(sql`
    select count(*) as n, count(*) filter (where l.is_critical) as c
      from ${RECOVERY_FROM} where ${recoveryWhere()} and ${scope}`);
  return { count: Number(res.rows[0]?.n ?? 0), critical: Number(res.rows[0]?.c ?? 0) };
}
