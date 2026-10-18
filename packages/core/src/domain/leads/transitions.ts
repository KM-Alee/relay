// Lead transitions T1–T11 (docs/03-lead-engine.md §5). Pure decisions: the service locks the row
// (SELECT … FOR UPDATE), calls one of these, then writes `patch` with `WHERE version = lead.version`
// and persists events / notifications / outbox / audit in the same transaction.
//
// Invariants enforced here (03 §9, requirements §9, C19):
//  - ownerUserId is never null (every result has an owner; fallback custody when nobody is eligible)
//  - escalationCount increments ONLY on an ack-timeout transfer (T3); overdue attempts, idle
//    re-triggers and other transfers have their own counters / event types
//  - fallback custody never acknowledges, never clears overdue, never stops retries
//  - every deadline goes through ctx.deadline (time-warp)
import type { ErrorCode } from '@relay/contracts/errors';
import { classifyRecovery } from './recovery';
import {
  dominantAwaitingReason,
  fallbackCustodian,
  ineligibilityReason,
  route,
  selectHandler,
  type RouteMode,
} from './route';
import type {
  AckVia,
  Actor,
  AuditAction,
  AuditIntent,
  AwaitingReason,
  ClosedReason,
  DeadlineFn,
  EngineFlags,
  EscalationPolicy,
  HumanActionType,
  LeadEventIntent,
  LeadEventType,
  LeadSnapshot,
  NotificationIntent,
  NotificationType,
  OutboxIntent,
  Person,
  RoutingTrace,
  SkipReason,
  SlackPurpose,
  TeamConfig,
  UserId,
} from './types';

export interface EngineContext {
  now: Date;
  deadline: DeadlineFn;
  team: TeamConfig;
  policy: EscalationPolicy;
  /** Team members + designated people (manager, backup, level users, workspace Owner, targets). */
  people: readonly Person[];
  workspaceOwnerUserId: UserId;
  flags: EngineFlags;
  requiredSkills?: readonly string[];
}

export type RejectionCode =
  | 'LEAD_CLOSED'
  | 'STALE_VERSION'
  | 'NOT_OWNER'
  | 'FALLBACK_CUSTODY'
  | 'ALREADY_ACKNOWLEDGED'
  | 'NOT_DUE'
  | 'NOT_AWAITING'
  | 'NOT_APPLICABLE'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_INACTIVE'
  | 'TARGET_INELIGIBLE'
  | 'OVERRIDE_REASON_REQUIRED'
  | 'SAME_OWNER'
  | 'FEATURE_DISABLED'
  | 'NOT_CLAIMABLE'
  | 'CLAIMER_INELIGIBLE';

/** How the service maps a rejection to the API envelope. Timer no-ops (NOT_DUE…) are silent skips. */
export const REJECTION_ERROR: Record<RejectionCode, ErrorCode> = {
  LEAD_CLOSED: 'LEAD_STATE_CHANGED',
  STALE_VERSION: 'LEAD_STATE_CHANGED',
  NOT_OWNER: 'LEAD_STATE_CHANGED',
  FALLBACK_CUSTODY: 'LEAD_STATE_CHANGED',
  ALREADY_ACKNOWLEDGED: 'LEAD_STATE_CHANGED',
  NOT_DUE: 'LEAD_STATE_CHANGED',
  NOT_AWAITING: 'LEAD_STATE_CHANGED',
  NOT_APPLICABLE: 'LEAD_STATE_CHANGED',
  TARGET_NOT_FOUND: 'NOT_FOUND',
  TARGET_INACTIVE: 'BUSINESS_RULE_VIOLATION',
  TARGET_INELIGIBLE: 'BUSINESS_RULE_VIOLATION',
  OVERRIDE_REASON_REQUIRED: 'VALIDATION_FAILED',
  SAME_OWNER: 'LEAD_STATE_CHANGED',
  FEATURE_DISABLED: 'NOT_FOUND',
  NOT_CLAIMABLE: 'ALREADY_CLAIMED',
  CLAIMER_INELIGIBLE: 'BUSINESS_RULE_VIOLATION',
};

export interface Rejected {
  ok: false;
  code: RejectionCode;
  currentOwnerUserId: UserId;
  detail?: { skipReason?: SkipReason };
  /** Recorded even on rejection (claim_rejected, 03 T8). */
  events: LeadEventIntent[];
}

export interface Applied {
  ok: true;
  /** false = nothing to write (e.g. non-owner action, absent owner's acknowledged lead). */
  changed: boolean;
  next: LeadSnapshot;
  /** Changed columns only (no `version`: the service sets version = version + 1). */
  patch: Partial<LeadSnapshot>;
  events: LeadEventIntent[];
  notifications: NotificationIntent[];
  outbox: OutboxIntent[];
  audit: AuditIntent[];
  /** Earliest timer on the lead → scheduler.ensureWakeBy(wakeAt). */
  wakeAt: Date | null;
  /** Write to teams.rr_cursor when not null. */
  newRrCursor: number | null;
  /** Non-transfer outcomes the UI explains (03 T5 banner). */
  kept?: 'acknowledged_owner_absent' | 'fallback_custody';
}

export type TransitionResult = Applied | Rejected;

// ── helpers ─────────────────────────────────────────────────────────────────

const reject = (
  lead: LeadSnapshot,
  code: RejectionCode,
  extra: Partial<Pick<Rejected, 'detail' | 'events'>> = {},
): Rejected => ({
  ok: false,
  code,
  currentOwnerUserId: lead.ownerUserId,
  events: extra.events ?? [],
  ...(extra.detail ? { detail: extra.detail } : {}),
});

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

function diff(prev: LeadSnapshot, next: LeadSnapshot): Partial<LeadSnapshot> {
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof LeadSnapshot)[]) {
    if (k !== 'version' && !sameValue(prev[k], next[k])) patch[k] = next[k];
  }
  return patch as Partial<LeadSnapshot>;
}

function earliest(...ds: (Date | null)[]): Date | null {
  let min: Date | null = null;
  for (const d of ds) if (d && (!min || d < min)) min = d;
  return min;
}

/** Collects side-effect intents for one transition. */
class Effects {
  events: LeadEventIntent[] = [];
  notifications: NotificationIntent[] = [];
  outbox: OutboxIntent[] = [];
  audit: AuditIntent[] = [];
  newRrCursor: number | null = null;

  constructor(
    private readonly next: LeadSnapshot,
    private readonly now: Date,
    private readonly actor: Actor,
  ) {}

  event(
    type: LeadEventType,
    from: UserId | null,
    trace: RoutingTrace | null = null,
    meta?: Record<string, unknown>,
  ) {
    this.events.push({
      type,
      fromUserId: from,
      toUserId: this.next.ownerUserId,
      custody: this.next.custody,
      escalationLevel: this.next.escalationLevel,
      trace,
      actorType: this.actor.type,
      actorUserId: this.actor.type === 'user' ? this.actor.userId : null,
      occurredAt: this.now,
      ...(meta ? { meta } : {}),
    });
  }

  /** In-app notification + Slack alert (Q4: every assignment alerts; F3.9 escalations mandatory). */
  notify(
    userId: UserId,
    type: NotificationType,
    purpose: SlackPurpose,
    params: Record<string, unknown> = {},
  ) {
    const leadId = this.next.id;
    this.notifications.push({ userId, type, leadId, params });
    const leadVersion = this.next.version;
    this.outbox.push({
      type: 'slack.send',
      payload: { leadId, userId, purpose, leadVersion },
      dedupeKey: `sl:${purpose}:${leadId}:${leadVersion}:${userId}`,
    });
  }

  auditLog(action: AuditAction, meta: Record<string, unknown> = {}) {
    this.audit.push({ action, actor: this.actor, meta });
  }
}

function applied(
  prev: LeadSnapshot | null,
  next: LeadSnapshot,
  fx: Effects,
  kept?: Applied['kept'],
): Applied {
  const patch = prev ? diff(prev, next) : { ...next };
  return {
    ok: true,
    changed: true,
    next,
    patch,
    events: fx.events,
    notifications: fx.notifications,
    outbox: fx.outbox,
    audit: fx.audit,
    wakeAt: next.status === 'open' ? earliest(next.escalateAt, next.routingRetryAt, next.idleCheckAt) : null,
    newRrCursor: fx.newRrCursor,
    ...(kept ? { kept } : {}),
  };
}

function unchanged(lead: LeadSnapshot, kept?: Applied['kept']): Applied {
  return {
    ok: true,
    changed: false,
    next: lead,
    patch: {},
    events: [],
    notifications: [],
    outbox: [],
    audit: [],
    wakeAt: null,
    newRrCursor: null,
    ...(kept ? { kept } : {}),
  };
}

/** Ack window for a fresh assignment; urgent leads use the shorter window when F3.12 is on. */
export function windowSeconds(ctx: EngineContext, isUrgent: boolean, levelTimeoutSeconds?: number): number {
  const base = levelTimeoutSeconds ?? ctx.team.ackWindowSeconds;
  return ctx.flags.urgentWindows && isUrgent ? Math.min(base, ctx.team.urgentAckWindowSeconds) : base;
}

const idleRetriggerOn = (ctx: EngineContext) => ctx.flags.idleRetrigger && ctx.team.idleRetriggerEnabled;

function sortedLevels(policy: EscalationPolicy) {
  return [...policy.levels].sort((a, b) => a.position - b.position);
}

/** Mutates `next` into handler custody, pending, with a fresh window. */
function toHandler(next: LeadSnapshot, ctx: EngineContext, toUserId: UserId, windowSecs: number) {
  if (next.ownerUserId !== toUserId) next.assignedAt = ctx.now;
  next.ownerUserId = toUserId;
  next.custody = 'handler';
  next.awaitingHandler = false;
  next.awaitingReason = null;
  next.ackStatus = 'pending';
  next.acknowledgedAt = null;
  next.acknowledgedVia = null;
  next.ackWindowEndsAt = next.escalateAt = ctx.deadline(ctx.now, windowSecs);
  next.routingRetryAt = null;
  next.idleCheckAt = null;
  next.isCritical = false;
}

/** Mutates `next` into fallback custody: pending, retries running. `windowSecs` null = keep escalate_at. */
function toFallback(
  next: LeadSnapshot,
  ctx: EngineContext,
  custodianId: UserId,
  reason: AwaitingReason,
  windowSecs: number | null,
) {
  if (next.ownerUserId !== custodianId) next.assignedAt = ctx.now;
  next.ownerUserId = custodianId;
  next.custody = 'fallback';
  next.awaitingHandler = true;
  next.awaitingReason = reason;
  next.ackStatus = 'pending';
  next.acknowledgedAt = null;
  next.acknowledgedVia = null;
  next.routingRetryAt = ctx.deadline(ctx.now, ctx.team.routingRetrySeconds);
  if (windowSecs !== null) next.ackWindowEndsAt = next.escalateAt = ctx.deadline(ctx.now, windowSecs);
  next.idleCheckAt = null;
}

function routeIn(
  ctx: EngineContext,
  mode: RouteMode,
  currentOwnerUserId: UserId | null,
  people = ctx.people,
) {
  return route({
    team: ctx.team,
    people,
    workspaceOwnerUserId: ctx.workspaceOwnerUserId,
    flags: ctx.flags,
    mode,
    currentOwnerUserId,
    requiredSkills: ctx.requiredSkills,
  });
}

function clearCritical(prev: LeadSnapshot, next: LeadSnapshot, fx: Effects) {
  if (prev.isCritical && !next.isCritical) fx.event('critical_cleared', prev.ownerUserId);
}

const bump = (lead: LeadSnapshot): LeadSnapshot => ({ ...lead, version: lead.version + 1 });

// ── T1 intake (F3.1, F3.3, F3.5) ────────────────────────────────────────────

export interface IntakeInput {
  id: string;
  workspaceId: string;
  isUrgent?: boolean;
  actor: Actor;
}

/** Builds the new lead WITH its owner already decided (never insert-then-assign). Always succeeds. */
export function intake(ctx: EngineContext, input: IntakeInput): Applied {
  const isUrgent = input.isUrgent ?? false;
  const windowEnd = ctx.deadline(ctx.now, windowSeconds(ctx, isUrgent));
  const decision = routeIn(ctx, 'intake', null);
  const handler = decision.kind === 'assign';
  const owner = decision.kind === 'broadcast_claim' ? decision.fallbackUserId : decision.toUserId;
  const next: LeadSnapshot = {
    id: input.id,
    workspaceId: input.workspaceId,
    teamId: ctx.team.id,
    status: 'open',
    closedReason: null,
    ownerUserId: owner,
    custody: handler ? 'handler' : 'fallback',
    awaitingHandler: !handler,
    awaitingReason:
      decision.kind === 'assign'
        ? null
        : decision.kind === 'fallback'
          ? decision.reason
          : 'first_to_claim_pending',
    ackStatus: 'pending',
    acknowledgedAt: null,
    acknowledgedVia: null,
    firstAssignedAt: ctx.now,
    assignedAt: ctx.now,
    firstAcknowledgedAt: null,
    lastHumanActionAt: null,
    isUrgent,
    isCritical: false,
    escalationLevel: 1,
    escalationCycle: 0,
    escalationCount: 0,
    idleRetriggerCount: 0,
    overdueAttemptCount: 0,
    ackWindowEndsAt: windowEnd,
    escalateAt: windowEnd,
    routingRetryAt: handler ? null : ctx.deadline(ctx.now, ctx.team.routingRetrySeconds),
    idleCheckAt: null,
    baseWindowEndsAt: windowEnd,
    version: 0,
  };
  const fx = new Effects(next, ctx.now, input.actor);
  fx.event('intake_assigned', null, decision.trace);
  fx.notify(owner, 'lead.assigned', 'assigned', { awaitingReason: next.awaitingReason });
  if (decision.kind === 'broadcast_claim') {
    for (const u of decision.notifyUserIds) fx.notify(u, 'lead.claimable', 'claimable');
  }
  if (decision.kind === 'assign') fx.newRrCursor = decision.newRrCursor;
  fx.auditLog('lead.assigned', {
    cause: 'intake',
    custody: next.custody,
    awaitingReason: next.awaitingReason,
  });
  return applied(null, next, fx);
}

// ── T2 acknowledge (F3.4, I4.5) + T10 human action (F2.13) ─────────────────

export interface AckInput {
  actorUserId: UserId;
  via: Extract<AckVia, 'app' | 'slack' | `action:${string}`>;
  /** Slack button carries the lead version it was sent for (I4.5): a different version is stale. */
  expectedVersion?: number;
}

export function acknowledge(ctx: EngineContext, lead: LeadSnapshot, input: AckInput): TransitionResult {
  if (lead.status !== 'open') return reject(lead, 'LEAD_CLOSED');
  if (input.expectedVersion !== undefined && input.expectedVersion !== lead.version)
    return reject(lead, 'STALE_VERSION');
  if (lead.ownerUserId !== input.actorUserId) return reject(lead, 'NOT_OWNER');
  // Fallback custody never acknowledges (03 §1, §11 Q3).
  if (lead.custody !== 'handler') return reject(lead, 'FALLBACK_CUSTODY');
  if (lead.ackStatus !== 'pending') return reject(lead, 'ALREADY_ACKNOWLEDGED');

  const next = bump(lead);
  next.ackStatus = 'acknowledged';
  next.acknowledgedAt = ctx.now;
  next.acknowledgedVia = input.via;
  next.firstAcknowledgedAt = lead.firstAcknowledgedAt ?? ctx.now;
  next.lastHumanActionAt = ctx.now;
  next.escalateAt = null;
  next.ackWindowEndsAt = null;
  next.routingRetryAt = null;
  next.isCritical = false;
  next.idleCheckAt = idleRetriggerOn(ctx) ? ctx.deadline(ctx.now, ctx.team.idleSeconds) : null;

  const fx = new Effects(next, ctx.now, { type: 'user', userId: input.actorUserId });
  fx.event('acknowledged', lead.ownerUserId, null, { via: input.via });
  clearCritical(lead, next, fx);
  fx.auditLog('lead.acknowledged', { via: input.via });
  fx.outbox.push({
    type: 'ai.handoff',
    payload: { leadId: lead.id, reason: 'human_ack' },
    dedupeKey: `ai:handoff:${lead.id}:${next.version}`,
  });
  return applied(lead, next, fx);
}

/**
 * T10: a recorded human action (note, call, outbound message, stage change, appointment).
 * Owner in handler custody: auto-acknowledges if pending, else bumps last_human_action_at.
 * Non-owners and fallback custodians: logged by the caller, changes nothing here.
 */
export function recordHumanAction(
  ctx: EngineContext,
  lead: LeadSnapshot,
  input: { actorUserId: UserId; action: HumanActionType },
): TransitionResult {
  if (lead.status !== 'open' || lead.ownerUserId !== input.actorUserId || lead.custody !== 'handler') {
    return unchanged(lead);
  }
  if (lead.ackStatus === 'pending') {
    return acknowledge(ctx, lead, { actorUserId: input.actorUserId, via: `action:${input.action}` });
  }
  const next = bump(lead);
  next.lastHumanActionAt = ctx.now;
  if (idleRetriggerOn(ctx)) next.idleCheckAt = ctx.deadline(ctx.now, ctx.team.idleSeconds);
  return applied(lead, next, new Effects(next, ctx.now, { type: 'user', userId: input.actorUserId }));
}

// ── T3 ack-window expiry → escalation (F3.5, F3.8, F3.9) ────────────────────

const SYSTEM: Actor = { type: 'system' };

/**
 * OQ-11 "kept owner": the window expired, nobody ELSE is eligible, and the current handler still is.
 * The lead stays with them (handler custody, pending) instead of bouncing to the fallback custodian and
 * back. Critical while kept = the chain is exhausted for this handler.
 */
const keptCritical = (lead: LeadSnapshot) =>
  lead.custody === 'handler' && lead.ackStatus === 'pending' && lead.isCritical;

const chainExhausted = (lead: LeadSnapshot) =>
  lead.isCritical && (lead.awaitingReason === 'chain_exhausted' || keptCritical(lead));

/** Is the current owner still an eligible handler for THIS lead (their count includes it)? */
function ownerStillEligible(ctx: EngineContext, lead: LeadSnapshot): boolean {
  if (lead.custody !== 'handler') return false;
  const p = ctx.people.find((x) => x.userId === lead.ownerUserId);
  if (!p) return false;
  const self = { ...p, openHandlerCount: Math.max(0, p.openHandlerCount - 1) };
  return (
    ineligibilityReason(self, {
      team: ctx.team,
      flags: ctx.flags,
      requiredSkills: ctx.requiredSkills,
      requireMembership: false,
    }) === null
  );
}

export function escalateOnAckTimeout(
  ctx: EngineContext,
  lead: LeadSnapshot,
  input: { triedThisCycle?: readonly UserId[] } = {},
): TransitionResult {
  if (lead.status !== 'open') return reject(lead, 'LEAD_CLOSED');
  if (lead.ackStatus !== 'pending') return reject(lead, 'ALREADY_ACKNOWLEDGED');
  if (!lead.escalateAt || lead.escalateAt > ctx.now) return reject(lead, 'NOT_DUE');
  // Exhausted chain: escalate_at runs at the retry cadence; a hit is a routing retry, not an escalation.
  if (chainExhausted(lead)) return retryRouting(ctx, lead, { kicked: true, syncEscalateAt: true });

  const levels = sortedLevels(ctx.policy);
  const trace: RoutingTrace = [];
  for (const level of levels.filter((l) => l.position > lead.escalationLevel)) {
    const sel = selectHandler({
      team: ctx.team,
      people: ctx.people,
      workspaceOwnerUserId: ctx.workspaceOwnerUserId,
      flags: ctx.flags,
      mode: 'escalation',
      level,
      currentOwnerUserId: lead.ownerUserId,
      triedThisCycle: input.triedThisCycle,
      requiredSkills: ctx.requiredSkills,
    });
    trace.push(...sel.trace);
    if (sel.kind !== 'assign') continue;

    // Transfer found: the ONLY place escalation_count increments.
    const next = bump(lead);
    toHandler(next, ctx, sel.toUserId, windowSeconds(ctx, lead.isUrgent, level.timeoutSeconds));
    next.escalationLevel = level.position;
    next.escalationCount = lead.escalationCount + 1;
    const fx = new Effects(next, ctx.now, SYSTEM);
    if (sel.newRrCursor !== null) fx.newRrCursor = sel.newRrCursor;
    fx.event('escalation', lead.ownerUserId, trace);
    clearCritical(lead, next, fx);
    fx.notify(sel.toUserId, 'lead.escalated', 'escalated', {
      fromUserId: lead.ownerUserId,
      level: level.position,
    });
    fx.auditLog('lead.escalated', {
      fromUserId: lead.ownerUserId,
      toUserId: sel.toUserId,
      level: level.position,
    });
    return applied(lead, next, fx);
  }

  // No transfer on this pass → overdue routing attempt (not an escalation).
  const cycle = lead.escalationCycle + 1;
  const exhausted = cycle >= Math.max(1, ctx.policy.repeatCount);
  const custodian = fallbackCustodian(ctx.team, ctx.people, ctx.workspaceOwnerUserId);
  const restartWindow = levels[0]?.timeoutSeconds ?? ctx.team.ackWindowSeconds;

  // OQ-11: the current handler is still eligible and nobody else is → keep them (no bounce to the
  // custodian and back). Overdue attempt, critical at end of chain, retries keep running via escalate_at.
  if (ownerStillEligible(ctx, lead)) {
    const next = bump(lead);
    next.overdueAttemptCount = lead.overdueAttemptCount + 1;
    next.escalationCycle = cycle;
    next.escalationLevel = 0;
    next.ackWindowEndsAt = next.escalateAt = ctx.deadline(
      ctx.now,
      exhausted ? ctx.team.routingRetrySeconds : restartWindow,
    );
    const fx = new Effects(next, ctx.now, SYSTEM);
    fx.event('overdue_attempt', lead.ownerUserId, trace, { kept: true });
    fx.auditLog('lead.overdue_attempt', {
      fromUserId: lead.ownerUserId,
      toUserId: lead.ownerUserId,
      kept: true,
    });
    if (exhausted && !lead.isCritical) {
      next.isCritical = true;
      fx.event('critical_flagged', lead.ownerUserId, null, { kept: true });
      fx.notify(lead.ownerUserId, 'lead.critical', 'critical');
      if (custodian.userId !== lead.ownerUserId) fx.notify(custodian.userId, 'lead.critical', 'critical');
      fx.auditLog('lead.critical_flagged', {
        custodianUserId: custodian.userId,
        ownerUserId: lead.ownerUserId,
      });
    }
    return applied(lead, next, fx);
  }

  // Otherwise: fallback custody (custodian ignores availability).
  const pseudo: RoutingTrace = [...trace];
  const reason: AwaitingReason = exhausted ? 'chain_exhausted' : dominantAwaitingReason(pseudo);
  pseudo.push({
    outcome: 'fallback',
    userId: custodian.userId,
    name: custodian.name,
    reason: custodian.basis,
    awaitingReason: reason,
  });

  const next = bump(lead);
  toFallback(next, ctx, custodian.userId, reason, exhausted ? ctx.team.routingRetrySeconds : restartWindow);
  next.overdueAttemptCount = lead.overdueAttemptCount + 1;
  next.escalationCycle = cycle;
  next.escalationLevel = 0; // next evaluation walks the policy from level 1
  const fx = new Effects(next, ctx.now, SYSTEM);
  fx.event('overdue_attempt', lead.ownerUserId, pseudo);
  fx.auditLog('lead.overdue_attempt', { fromUserId: lead.ownerUserId, toUserId: custodian.userId, reason });
  if (lead.ownerUserId !== custodian.userId)
    fx.notify(custodian.userId, 'lead.assigned', 'assigned', { awaitingReason: reason });
  if (exhausted) {
    // End of chain (F3.5): critical, custodian alerted even if unavailable; retries continue.
    next.isCritical = true;
    fx.event('critical_flagged', lead.ownerUserId);
    fx.notify(custodian.userId, 'lead.critical', 'critical');
    fx.auditLog('lead.critical_flagged', { custodianUserId: custodian.userId });
  }
  return applied(lead, next, fx);
}

// ── T4 routing retry (F3.3) ─────────────────────────────────────────────────

export function retryRouting(
  ctx: EngineContext,
  lead: LeadSnapshot,
  input: { kicked?: boolean; syncEscalateAt?: boolean } = {},
): TransitionResult {
  if (lead.status !== 'open') return reject(lead, 'LEAD_CLOSED');
  if (keptCritical(lead)) return retryKeptOwner(ctx, lead, input);
  if (!lead.awaitingHandler) return reject(lead, 'NOT_AWAITING');
  if (!input.kicked && (!lead.routingRetryAt || lead.routingRetryAt > ctx.now))
    return reject(lead, 'NOT_DUE');

  const decision = routeIn(ctx, 'retry', null);
  const next = bump(lead);
  const fx = new Effects(next, ctx.now, SYSTEM);
  if (decision.kind === 'assign') {
    toHandler(next, ctx, decision.toUserId, windowSeconds(ctx, lead.isUrgent));
    fx.newRrCursor = decision.newRrCursor;
    fx.event('routing_retry_assigned', lead.ownerUserId, decision.trace);
    clearCritical(lead, next, fx);
    fx.notify(decision.toUserId, 'lead.assigned', 'assigned');
    fx.auditLog('lead.assigned', { cause: 'routing_retry', fromUserId: lead.ownerUserId });
    return applied(lead, next, fx);
  }
  // Still nobody: custodian keeps custody, retries continue. Critical keeps 'chain_exhausted'.
  next.routingRetryAt = ctx.deadline(ctx.now, ctx.team.routingRetrySeconds);
  if (input.syncEscalateAt || chainExhausted(lead))
    next.escalateAt = next.ackWindowEndsAt = next.routingRetryAt;
  if (!chainExhausted(lead)) {
    next.awaitingReason = decision.kind === 'fallback' ? decision.reason : 'first_to_claim_pending';
  }
  if (decision.kind === 'broadcast_claim' && lead.awaitingReason !== 'first_to_claim_pending') {
    for (const u of decision.notifyUserIds) fx.notify(u, 'lead.claimable', 'claimable');
  }
  return applied(lead, next, fx);
}

/**
 * OQ-11 retry for a kept critical handler lead (exhausted chain, owner still pending). Another eligible
 * handler → `routing_retry_assigned` (fresh window, NOT an escalation). Nobody else and the owner is
 * still eligible → silent reschedule at the retry cadence. Owner no longer eligible (e.g. Busy) →
 * fallback custody, recorded as an overdue attempt with from/to (03 T3 step 4).
 */
function retryKeptOwner(
  ctx: EngineContext,
  lead: LeadSnapshot,
  input: { kicked?: boolean },
): TransitionResult {
  if (!input.kicked && (!lead.escalateAt || lead.escalateAt > ctx.now)) return reject(lead, 'NOT_DUE');
  const decision = routeIn(ctx, 'retry', lead.ownerUserId);
  const next = bump(lead);
  const fx = new Effects(next, ctx.now, SYSTEM);
  if (decision.kind === 'assign') {
    toHandler(next, ctx, decision.toUserId, windowSeconds(ctx, lead.isUrgent));
    fx.newRrCursor = decision.newRrCursor;
    fx.event('routing_retry_assigned', lead.ownerUserId, decision.trace);
    clearCritical(lead, next, fx);
    fx.notify(decision.toUserId, 'lead.assigned', 'assigned');
    fx.auditLog('lead.assigned', { cause: 'routing_retry', fromUserId: lead.ownerUserId });
    return applied(lead, next, fx);
  }
  if (ownerStillEligible(ctx, lead)) {
    next.ackWindowEndsAt = next.escalateAt = ctx.deadline(ctx.now, ctx.team.routingRetrySeconds);
    return applied(lead, next, fx);
  }
  const custodian = fallbackCustodian(ctx.team, ctx.people, ctx.workspaceOwnerUserId);
  toFallback(next, ctx, custodian.userId, 'chain_exhausted', ctx.team.routingRetrySeconds);
  next.isCritical = true;
  next.overdueAttemptCount = lead.overdueAttemptCount + 1;
  fx.event('overdue_attempt', lead.ownerUserId, [
    ...decision.trace.filter((e) => e.outcome !== 'fallback'),
    {
      outcome: 'fallback',
      userId: custodian.userId,
      name: custodian.name,
      reason: custodian.basis,
      awaitingReason: 'chain_exhausted',
    },
  ]);
  if (custodian.userId !== lead.ownerUserId) fx.notify(custodian.userId, 'lead.critical', 'critical');
  fx.auditLog('lead.overdue_attempt', {
    fromUserId: lead.ownerUserId,
    toUserId: custodian.userId,
    reason: 'chain_exhausted',
  });
  return applied(lead, next, fx);
}

// ── T5 absence (F3.6) / T6 deactivation (F1.8) ──────────────────────────────

export function reassignOnAbsence(
  ctx: EngineContext,
  lead: LeadSnapshot,
  input: { userId: UserId; availability: Person['availability']; actor: Actor },
): TransitionResult {
  if (input.availability !== 'on_leave' && input.availability !== 'offline')
    return reject(lead, 'NOT_APPLICABLE');
  if (lead.status !== 'open') return reject(lead, 'LEAD_CLOSED');
  if (lead.ownerUserId !== input.userId) return reject(lead, 'NOT_OWNER');
  if (lead.custody === 'fallback') return unchanged(lead, 'fallback_custody'); // custody needs no availability
  if (lead.ackStatus === 'acknowledged') return unchanged(lead, 'acknowledged_owner_absent'); // P0: stays + banner
  return transferAway(ctx, lead, 'absence', input.actor, ctx.people);
}

export function transferOnDeactivation(
  ctx: EngineContext,
  lead: LeadSnapshot,
  input: { userId: UserId; actor: Actor },
): TransitionResult {
  if (lead.status !== 'open') return reject(lead, 'LEAD_CLOSED');
  if (lead.ownerUserId !== input.userId) return reject(lead, 'NOT_OWNER');
  // Defensive: treat the user as inactive even if the caller passed a pre-change snapshot.
  const people = ctx.people.map((p) => (p.userId === input.userId ? { ...p, isActive: false } : p));
  return transferAway(ctx, lead, 'deactivation', input.actor, people);
}

function transferAway(
  ctx: EngineContext,
  lead: LeadSnapshot,
  mode: 'absence' | 'deactivation',
  actor: Actor,
  people: readonly Person[],
): Applied {
  const decision = routeIn(ctx, mode, lead.ownerUserId, people);
  const next = bump(lead);
  const fx = new Effects(next, ctx.now, actor);
  const windowSecs = windowSeconds(ctx, lead.isUrgent);
  if (decision.kind === 'assign') {
    toHandler(next, ctx, decision.toUserId, windowSecs);
    fx.newRrCursor = decision.newRrCursor;
  } else {
    const to = decision.kind === 'fallback' ? decision.toUserId : decision.fallbackUserId;
    toFallback(next, ctx, to, mode === 'absence' ? 'owner_absent' : 'owner_deactivated', windowSecs);
  }
  fx.event(
    mode === 'absence' ? 'absence_reassign' : 'deactivation_reassign',
    lead.ownerUserId,
    decision.trace,
  );
  clearCritical(lead, next, fx);
  if (next.ownerUserId !== lead.ownerUserId)
    fx.notify(next.ownerUserId, 'lead.reassigned', 'reassigned', { cause: mode });
  fx.auditLog('lead.reassigned', { cause: mode, fromUserId: lead.ownerUserId, toUserId: next.ownerUserId });
  return applied(lead, next, fx);
}

/** F1.8 guard: the workspace Owner and any configured team manager (fallback) cannot be deactivated. */
export function canDeactivateUser(input: {
  userId: UserId;
  workspaceOwnerUserId: UserId;
  teams: readonly { id: string; managerUserId: UserId | null }[];
}): { ok: true } | { ok: false; reason: 'workspace_owner' | 'team_manager'; teamIds: string[] } {
  if (input.userId === input.workspaceOwnerUserId)
    return { ok: false, reason: 'workspace_owner', teamIds: [] };
  const teamIds = input.teams.filter((t) => t.managerUserId === input.userId).map((t) => t.id);
  return teamIds.length ? { ok: false, reason: 'team_manager', teamIds } : { ok: true };
}

// ── T7 manual reassign (permission leads.reassign; 03 §11 Q2/Q3) ────────────

export function manualReassign(
  ctx: EngineContext,
  lead: LeadSnapshot,
  input: {
    actorUserId: UserId;
    toUserId: UserId;
    override?: { reason: string };
    /** 03 §11 Q3 "Take over": the fallback custodian takes the lead as handler (must be eligible; a
     * designated custodian need not be a team member, OQ-8). No override. */
    takeOver?: boolean;
  },
): TransitionResult {
  if (lead.status !== 'open') return reject(lead, 'LEAD_CLOSED');
  if (input.takeOver && (input.toUserId !== input.actorUserId || input.override))
    return reject(lead, 'NOT_APPLICABLE');
  if (input.takeOver && (lead.custody !== 'fallback' || lead.ownerUserId !== input.actorUserId))
    return reject(lead, 'NOT_OWNER');
  const target = ctx.people.find((p) => p.userId === input.toUserId);
  if (!target) return reject(lead, 'TARGET_NOT_FOUND');
  if (!target.isActive) return reject(lead, 'TARGET_INACTIVE', { detail: { skipReason: 'inactive' } }); // never, even with override
  if (target.userId === lead.ownerUserId && lead.custody === 'handler') return reject(lead, 'SAME_OWNER');
  const why = ineligibilityReason(target, {
    team: ctx.team,
    flags: ctx.flags,
    requiredSkills: ctx.requiredSkills,
    requireMembership: !input.takeOver,
  });
  if (why && input.takeOver) return reject(lead, 'TARGET_INELIGIBLE', { detail: { skipReason: why } });
  if (why && !input.override) return reject(lead, 'TARGET_INELIGIBLE', { detail: { skipReason: why } });
  if (why && !input.override?.reason.trim()) return reject(lead, 'OVERRIDE_REASON_REQUIRED');

  const next = bump(lead);
  toHandler(next, ctx, target.userId, windowSeconds(ctx, lead.isUrgent));
  const fx = new Effects(next, ctx.now, { type: 'user', userId: input.actorUserId });
  const trace: RoutingTrace = [];
  if (why) trace.push({ outcome: 'skipped', userId: target.userId, name: target.name, reason: why });
  trace.push({
    outcome: 'chosen',
    userId: target.userId,
    name: target.name,
    reason: why ? 'manual_override' : 'manual',
  });
  const meta = why
    ? { override: true, overrideReason: input.override?.reason.trim(), ineligibleReason: why }
    : { override: false, ...(input.takeOver ? { takeOver: true } : {}) };
  fx.event('manual_reassign', lead.ownerUserId, trace, meta);
  clearCritical(lead, next, fx);
  if (!input.takeOver) fx.notify(target.userId, 'lead.reassigned', 'reassigned', { cause: 'manual' });
  // Capacity freed for the previous handler → kick team routing retry (03 T4).
  if (lead.custody === 'handler' && lead.ownerUserId !== target.userId)
    fx.outbox.push({
      type: 'lead.retry_routing',
      payload: { teamId: lead.teamId },
      dedupeKey: `rr:${lead.teamId}:${Math.floor(ctx.now.getTime() / 1000)}`,
    });
  fx.auditLog('lead.reassigned', {
    cause: 'manual',
    fromUserId: lead.ownerUserId,
    toUserId: target.userId,
    ...meta,
  });
  return applied(lead, next, fx);
}

// ── T8 claims (P1: first-to-claim F3.3c, pond F3.7) ─────────────────────────

export function claim(
  ctx: EngineContext,
  lead: LeadSnapshot,
  input: { claimerUserId: UserId; kind: 'claim' | 'pond_claim'; idleSeconds?: number },
): TransitionResult {
  const enabled = input.kind === 'claim' ? ctx.flags.firstToClaim : ctx.flags.pondClaim;
  if (!enabled) return reject(lead, 'FEATURE_DISABLED');
  const rejected = (code: RejectionCode, skipReason?: SkipReason) =>
    reject(lead, code, {
      ...(skipReason ? { detail: { skipReason } } : {}),
      events: [
        {
          type: 'claim_rejected',
          fromUserId: lead.ownerUserId,
          toUserId: input.claimerUserId,
          custody: lead.custody,
          escalationLevel: lead.escalationLevel,
          trace: null,
          actorType: 'user',
          actorUserId: input.claimerUserId,
          occurredAt: ctx.now,
          meta: { kind: input.kind, code },
        },
      ],
    });
  if (lead.status !== 'open') return rejected('NOT_CLAIMABLE');
  const claimable =
    input.kind === 'claim'
      ? lead.custody === 'fallback' && lead.awaitingReason === 'first_to_claim_pending'
      : classifyRecovery(lead, {
          now: ctx.now,
          deadline: ctx.deadline,
          idleSeconds: input.idleSeconds ?? ctx.team.idleSeconds,
        }).length > 0;
  if (!claimable || (lead.ownerUserId === input.claimerUserId && lead.custody === 'handler'))
    return rejected('NOT_CLAIMABLE');
  const claimer = ctx.people.find((p) => p.userId === input.claimerUserId);
  const why = claimer
    ? ineligibilityReason(claimer, {
        team: ctx.team,
        flags: ctx.flags,
        requiredSkills: ctx.requiredSkills,
        requireMembership: true,
      })
    : 'unknown_user';
  if (why) return rejected('CLAIMER_INELIGIBLE', why);

  const next = bump(lead);
  if (next.ownerUserId !== input.claimerUserId) next.assignedAt = ctx.now;
  next.ownerUserId = input.claimerUserId;
  next.custody = 'handler';
  next.awaitingHandler = false;
  next.awaitingReason = null;
  next.ackStatus = 'acknowledged';
  next.acknowledgedAt = ctx.now;
  next.acknowledgedVia = input.kind;
  next.firstAcknowledgedAt = lead.firstAcknowledgedAt ?? ctx.now;
  next.lastHumanActionAt = ctx.now;
  next.escalateAt = next.ackWindowEndsAt = next.routingRetryAt = null;
  next.isCritical = false;
  next.idleCheckAt = idleRetriggerOn(ctx) ? ctx.deadline(ctx.now, ctx.team.idleSeconds) : null;
  const fx = new Effects(next, ctx.now, { type: 'user', userId: input.claimerUserId });
  fx.event(input.kind, lead.ownerUserId, [
    { outcome: 'chosen', userId: input.claimerUserId, name: claimer?.name ?? '', reason: input.kind },
  ]);
  clearCritical(lead, next, fx);
  fx.auditLog('lead.claimed', { kind: input.kind, fromUserId: lead.ownerUserId });
  fx.outbox.push({
    type: 'ai.handoff',
    payload: { leadId: lead.id, reason: 'claim' },
    dedupeKey: `ai:handoff:${lead.id}:${next.version}`,
  });
  return applied(lead, next, fx);
}

// ── T9 idle re-trigger (P1 F3.10) ───────────────────────────────────────────

export function idleRetrigger(ctx: EngineContext, lead: LeadSnapshot): TransitionResult {
  if (!idleRetriggerOn(ctx)) return reject(lead, 'FEATURE_DISABLED');
  if (lead.status !== 'open') return reject(lead, 'LEAD_CLOSED');
  if (lead.ackStatus !== 'acknowledged' || lead.custody !== 'handler') return reject(lead, 'NOT_APPLICABLE');
  if (!lead.idleCheckAt || lead.idleCheckAt > ctx.now) return reject(lead, 'NOT_DUE');

  const next = bump(lead);
  const lastAction = lead.lastHumanActionAt ?? lead.acknowledgedAt ?? lead.assignedAt;
  const idleUntil = ctx.deadline(lastAction, ctx.team.idleSeconds);
  if (idleUntil > ctx.now) {
    next.idleCheckAt = idleUntil; // an action moved it; not idle yet
    return applied(lead, next, new Effects(next, ctx.now, SYSTEM));
  }
  const decision = routeIn(ctx, 'idle_retrigger', lead.ownerUserId);
  const fx = new Effects(next, ctx.now, SYSTEM);
  const windowSecs = windowSeconds(ctx, lead.isUrgent);
  if (decision.kind === 'assign') {
    toHandler(next, ctx, decision.toUserId, windowSecs);
    fx.newRrCursor = decision.newRrCursor;
  } else {
    const to = decision.kind === 'fallback' ? decision.toUserId : decision.fallbackUserId;
    toFallback(
      next,
      ctx,
      to,
      decision.kind === 'fallback' ? decision.reason : 'first_to_claim_pending',
      windowSecs,
    );
  }
  // Fresh chain for the new handler; first_* timestamps and escalation_count untouched (03 §9.7).
  next.escalationLevel = 1;
  next.escalationCycle = 0;
  if (next.ownerUserId !== lead.ownerUserId) next.idleRetriggerCount = lead.idleRetriggerCount + 1;
  fx.event('idle_retrigger', lead.ownerUserId, decision.trace);
  if (next.ownerUserId !== lead.ownerUserId)
    fx.notify(next.ownerUserId, 'lead.reassigned', 'reassigned', { cause: 'idle_retrigger' });
  fx.auditLog('lead.idle_retriggered', { fromUserId: lead.ownerUserId, toUserId: next.ownerUserId });
  return applied(lead, next, fx);
}

// ── T11 close ───────────────────────────────────────────────────────────────

export function closeLead(
  ctx: EngineContext,
  lead: LeadSnapshot,
  input: { reason: ClosedReason; actor: Actor },
): TransitionResult {
  if (lead.status !== 'open') return reject(lead, 'LEAD_CLOSED');
  const next = bump(lead);
  next.status = 'closed';
  next.closedReason = input.reason;
  next.escalateAt = next.ackWindowEndsAt = next.routingRetryAt = next.idleCheckAt = null;
  next.isCritical = false;
  const fx = new Effects(next, ctx.now, input.actor);
  fx.event('closed', lead.ownerUserId, null, { reason: input.reason });
  fx.auditLog('lead.closed', { reason: input.reason });
  // Capacity freed → kick routing retry for the team (03 T4).
  fx.outbox.push({
    type: 'lead.retry_routing',
    payload: { teamId: lead.teamId },
    dedupeKey: `rr:${lead.teamId}:${Math.floor(ctx.now.getTime() / 1000)}`,
  });
  return applied(lead, next, fx);
}

// ── UI state label (03 §2, i18n lead.state.*) ───────────────────────────────

export type LeadStateLabel =
  'awaitingHandler' | 'assignedPending' | 'overdue' | 'critical' | 'acknowledged' | 'idle' | 'closed';

export function leadStateLabel(
  lead: LeadSnapshot,
  o: { now: Date; deadline: DeadlineFn; idleSeconds: number },
): LeadStateLabel {
  if (lead.status === 'closed') return 'closed';
  if (lead.isCritical) return 'critical';
  if (lead.ackStatus === 'acknowledged') {
    const last = lead.lastHumanActionAt ?? lead.acknowledgedAt ?? lead.firstAssignedAt;
    return o.deadline(last, o.idleSeconds) < o.now ? 'idle' : 'acknowledged';
  }
  if (o.now > lead.baseWindowEndsAt) return 'overdue';
  return lead.awaitingHandler ? 'awaitingHandler' : 'assignedPending';
}
