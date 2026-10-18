// Recovery queue classification R1–R5 (docs/03-lead-engine.md §7, F3.7). Pure mirror of the SQL in
// repos/recoveryQueue.ts so the two can be tested against each other.
import type { DeadlineFn, LeadSnapshot } from './types';

export type RecoveryReason = 'overdue' | 'escalated2' | 'idle' | 'awaiting' | 'critical';

export interface RecoveryOptions {
  now: Date;
  deadline: DeadlineFn;
  idleSeconds: number;
}

/** Every matching reason, in R1..R5 order. Empty = not in the queue. Each criterion is independent. */
export function classifyRecovery(lead: LeadSnapshot, o: RecoveryOptions): RecoveryReason[] {
  if (lead.status !== 'open') return [];
  const reasons: RecoveryReason[] = [];
  if (lead.ackStatus === 'pending' && o.now > lead.baseWindowEndsAt) reasons.push('overdue'); // R1
  if (lead.escalationCount >= 2) reasons.push('escalated2'); // R2 (idle re-triggers excluded)
  const last = lead.lastHumanActionAt ?? lead.acknowledgedAt ?? lead.firstAssignedAt;
  if (o.deadline(last, o.idleSeconds) < o.now) reasons.push('idle'); // R3
  if (lead.awaitingHandler) reasons.push('awaiting'); // R4
  if (lead.isCritical) reasons.push('critical'); // R5
  return reasons;
}

/** Queue order: critical, then urgent, then oldest first_assigned_at. */
export function compareRecovery(a: LeadSnapshot, b: LeadSnapshot): number {
  if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
  if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
  return a.firstAssignedAt.getTime() - b.firstAssignedAt.getTime();
}
