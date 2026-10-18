// Lead engine domain types (docs/03-lead-engine.md, docs/02-data-model.md §2 + §4).
// Field names are the camelCase of the DB columns so repos can map 1:1. Pure: no I/O, no clock.

export type UserId = string;
export type LeadId = string;

// ── users / teams / policies (02 §1, §2) ────────────────────────────────────

export type Availability = 'available' | 'busy' | 'on_leave' | 'offline';

/**
 * A person the engine may consider: every team member, plus the designated people
 * (team manager, team backup, `user` level targets, a manual-reassign target, a claimer).
 */
export interface Person {
  userId: UserId;
  name: string;
  isActive: boolean;
  availability: Availability;
  /** `count(leads WHERE owner_user_id=u AND custody='handler' AND status='open')` (03 §1, §11 Q1). */
  openHandlerCount: number;
  /** `users.capacity` (P1 F3.3e). NULL = team default. */
  capacity: number | null;
  skills: readonly string[];
  /** `team_members.position` of this lead's team; `null` = not a member of the team. */
  position: number | null;
}

export type RoutingMode = 'round_robin' | 'first_to_claim';

export interface TeamConfig {
  id: string;
  managerUserId: UserId | null;
  backupUserId: UserId | null;
  routingMode: RoutingMode;
  /** `teams.rr_cursor`: the `position` of the member chosen last by round-robin. */
  rrCursor: number;
  defaultCapacity: number;
  skillsRouting: boolean;
  ackWindowSeconds: number;
  urgentAckWindowSeconds: number;
  routingRetrySeconds: number;
  idleSeconds: number;
  idleRetriggerEnabled: boolean;
}

export type LevelTargetType = 'next_eligible' | 'user' | 'team_backup' | 'team_manager';

export interface EscalationLevel {
  /** 1-based, `escalation_levels.position`. */
  position: number;
  targetType: LevelTargetType;
  targetUserId: UserId | null;
  timeoutSeconds: number;
}

export interface EscalationPolicy {
  id: string;
  repeatCount: number;
  /** Any order; the engine sorts by `position`. */
  levels: readonly EscalationLevel[];
}

/**
 * Workspace feature flags (AGENTS.md rule 8). P0 = everything off. A P1 behaviour only runs when
 * its flag is on AND the team setting asks for it.
 */
export interface EngineFlags {
  firstToClaim: boolean; // F3.3c (with team.routingMode='first_to_claim')
  skillsRouting: boolean; // F3.3d (with team.skillsRouting)
  perEmployeeCapacity: boolean; // F3.3e (users.capacity)
  idleRetrigger: boolean; // F3.10 (with team.idleRetriggerEnabled)
  urgentWindows: boolean; // F3.12
  pondClaim: boolean; // F3.7 P1
}

export const P0_FLAGS: EngineFlags = {
  firstToClaim: false,
  skillsRouting: false,
  perEmployeeCapacity: false,
  idleRetrigger: false,
  urgentWindows: false,
  pondClaim: false,
};

/** `now + seconds` scaled by time-warp. The service binds `(now, s) => clock.deadline(ws, s, now)`. */
export type DeadlineFn = (from: Date, seconds: number) => Date;

// ── leads (02 §4) ───────────────────────────────────────────────────────────

export type LeadStatus = 'open' | 'closed';
export type Custody = 'handler' | 'fallback';
export type AckStatus = 'pending' | 'acknowledged';
export type AwaitingReason =
  | 'no_available'
  | 'all_at_capacity'
  | 'no_skill_match'
  | 'first_to_claim_pending'
  | 'chain_exhausted'
  | 'owner_absent'
  | 'owner_deactivated';
export type HumanActionType = 'note' | 'call' | 'message_out' | 'stage_change' | 'appointment';
export type AckVia = 'app' | 'slack' | `action:${HumanActionType}` | 'claim' | 'pond_claim';
export type ClosedReason = 'won' | 'lost' | 'disqualified' | 'merged';

/** The engine-owned columns of a `leads` row. */
export interface LeadSnapshot {
  id: LeadId;
  workspaceId: string;
  teamId: string;
  status: LeadStatus;
  closedReason: ClosedReason | null;
  ownerUserId: UserId; // NEVER null
  custody: Custody;
  awaitingHandler: boolean;
  awaitingReason: AwaitingReason | null;
  ackStatus: AckStatus;
  acknowledgedAt: Date | null;
  acknowledgedVia: AckVia | null;
  firstAssignedAt: Date; // never reset
  assignedAt: Date;
  firstAcknowledgedAt: Date | null; // never reset once set
  lastHumanActionAt: Date | null;
  isUrgent: boolean;
  isCritical: boolean;
  escalationLevel: number;
  escalationCycle: number;
  escalationCount: number; // ack-timeout transfers ONLY
  idleRetriggerCount: number;
  overdueAttemptCount: number;
  ackWindowEndsAt: Date | null;
  escalateAt: Date | null;
  routingRetryAt: Date | null;
  idleCheckAt: Date | null;
  baseWindowEndsAt: Date;
  version: number;
}

// ── routing trace + intents ─────────────────────────────────────────────────

export type SkipReason =
  | 'inactive'
  | 'not_member'
  | 'on_leave'
  | 'offline'
  | 'busy'
  | 'at_capacity'
  | 'no_skill'
  | 'already_tried'
  | 'current_owner'
  | 'no_target' // level target not configured / unknown user
  | 'unknown_user';

export type ChosenReason =
  'round_robin_next' | 'level_target' | 'manual' | 'manual_override' | 'claim' | 'pond_claim';

export type TraceEntry =
  | {
      outcome: 'skipped';
      userId: UserId | null;
      name: string | null;
      reason: SkipReason;
      level?: number;
      /** For at_capacity: e.g. 5/5 (F3.11 "skipped Sara (5/5 open leads)"). */
      openCount?: number;
      capacity?: number;
    }
  | { outcome: 'chosen'; userId: UserId; name: string; reason: ChosenReason; level?: number }
  | { outcome: 'broadcast'; userId: UserId; name: string; reason: 'eligible_claimant' }
  | {
      outcome: 'fallback';
      userId: UserId;
      name: string;
      reason: 'team_manager' | 'workspace_owner';
      awaitingReason: AwaitingReason;
    };

export type RoutingTrace = TraceEntry[];

export type LeadEventType =
  | 'intake_assigned'
  | 'routing_retry_assigned'
  | 'escalation'
  | 'overdue_attempt'
  | 'absence_reassign'
  | 'deactivation_reassign'
  | 'manual_reassign'
  | 'claim'
  | 'pond_claim'
  | 'claim_rejected'
  | 'idle_retrigger'
  | 'acknowledged'
  | 'critical_flagged'
  | 'critical_cleared'
  | 'closed';

export type Actor = { type: 'user'; userId: UserId } | { type: 'system' };

/** One `lead_events` row (02 §4). */
export interface LeadEventIntent {
  type: LeadEventType;
  fromUserId: UserId | null;
  toUserId: UserId | null;
  custody: Custody;
  escalationLevel: number;
  trace: RoutingTrace | null;
  actorType: 'user' | 'system';
  actorUserId: UserId | null;
  occurredAt: Date;
  meta?: Record<string, unknown>;
}

export type NotificationType =
  'lead.assigned' | 'lead.escalated' | 'lead.reassigned' | 'lead.critical' | 'lead.claimable';

/** One `notifications` row (in-app centre, F3.4). */
export interface NotificationIntent {
  userId: UserId;
  type: NotificationType;
  leadId: LeadId;
  params: Record<string, unknown>;
}

export type SlackPurpose = 'assigned' | 'escalated' | 'reassigned' | 'critical' | 'claimable';

/** Outbox rows (04 §7). `wake.schedule` is not emitted here: the service calls ensureWakeBy(wakeAt). */
export type OutboxIntent =
  | {
      type: 'slack.send';
      payload: { leadId: LeadId; userId: UserId; purpose: SlackPurpose; leadVersion: number };
      dedupeKey: string;
    }
  | { type: 'ai.handoff'; payload: { leadId: LeadId; reason: 'human_ack' | 'claim' }; dedupeKey: string }
  | { type: 'lead.retry_routing'; payload: { teamId: string }; dedupeKey: string };

export type AuditAction =
  | 'lead.assigned'
  | 'lead.escalated'
  | 'lead.overdue_attempt'
  | 'lead.reassigned'
  | 'lead.claimed'
  | 'lead.acknowledged'
  | 'lead.idle_retriggered'
  | 'lead.critical_flagged'
  | 'lead.closed';

/** `audit.append()` input (06 §6). before/after are filled by the service from the patch. */
export interface AuditIntent {
  action: AuditAction;
  actor: Actor;
  meta: Record<string, unknown>;
}
