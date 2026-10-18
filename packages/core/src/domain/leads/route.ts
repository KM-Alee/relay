// Routing (docs/03-lead-engine.md §4). Pure: the caller passes people, team, flags and the cursor.
// F3.3 round-robin + capacity, F3.5 skip reasons + fallback custody, F3.11 trace data.
import type {
  AwaitingReason,
  EngineFlags,
  EscalationLevel,
  Person,
  RoutingTrace,
  SkipReason,
  TeamConfig,
  TraceEntry,
  UserId,
} from './types';

export type RouteMode = 'intake' | 'escalation' | 'retry' | 'absence' | 'deactivation' | 'idle_retrigger';

export interface RouteInput {
  team: TeamConfig;
  /** Team members (position set) plus designated people (manager, backup, level users, workspace Owner). */
  people: readonly Person[];
  workspaceOwnerUserId: UserId;
  flags: EngineFlags;
  mode: RouteMode;
  /** Escalation only: the level being evaluated. Absent = plain rotation. */
  level?: EscalationLevel;
  /** Skipped as `current_owner` (escalation, absence, deactivation, idle re-trigger). */
  currentOwnerUserId?: UserId | null;
  /** Escalation only: owners already tried in the current cycle, skipped as `already_tried`. */
  triedThisCycle?: readonly UserId[];
  /** Lead attributes for skill routing (P1 F3.3d). Ignored unless the flag and team setting are on. */
  requiredSkills?: readonly string[];
}

export type SelectResult =
  | {
      kind: 'assign';
      toUserId: UserId;
      /** Set when the round-robin rotation chose the user: the service writes it to `teams.rr_cursor`. */
      newRrCursor: number | null;
      trace: RoutingTrace;
    }
  | { kind: 'none'; awaitingReason: AwaitingReason; trace: RoutingTrace };

export type RoutingDecision =
  | { kind: 'assign'; toUserId: UserId; custody: 'handler'; newRrCursor: number | null; trace: RoutingTrace }
  | { kind: 'fallback'; toUserId: UserId; reason: AwaitingReason; trace: RoutingTrace }
  | { kind: 'broadcast_claim'; fallbackUserId: UserId; notifyUserIds: UserId[]; trace: RoutingTrace };

export interface EligibilityOptions {
  team: TeamConfig;
  flags: EngineFlags;
  requiredSkills?: readonly string[];
  /** Rotation and claims require team membership; named targets (backup, manager, level user) do not. */
  requireMembership: boolean;
}

export function effectiveCapacity(p: Person, team: TeamConfig, flags: EngineFlags): number {
  return flags.perEmployeeCapacity && p.capacity !== null ? p.capacity : team.defaultCapacity;
}

/** Eligible-handler check (03 §1), in the 03 §4 step 2 precedence. `null` = eligible. */
export function ineligibilityReason(p: Person, o: EligibilityOptions): SkipReason | null {
  if (!p.isActive) return 'inactive';
  if (o.requireMembership && p.position === null) return 'not_member';
  if (p.availability !== 'available') return p.availability;
  if (p.openHandlerCount >= effectiveCapacity(p, o.team, o.flags)) return 'at_capacity';
  if (o.flags.skillsRouting && o.team.skillsRouting && o.requiredSkills?.length) {
    if (!o.requiredSkills.every((s) => p.skills.includes(s))) return 'no_skill';
  }
  return null;
}

function skipEntry(p: Person, reason: SkipReason, o: EligibilityOptions, level?: number): TraceEntry {
  const e: TraceEntry = { outcome: 'skipped', userId: p.userId, name: p.name, reason };
  if (level !== undefined) e.level = level;
  if (reason === 'at_capacity') {
    e.openCount = p.openHandlerCount;
    e.capacity = effectiveCapacity(p, o.team, o.flags);
  }
  return e;
}

/** Members in `position` order, rotated to start after the member at `rrCursor` (03 §4 step 1). */
export function rotateMembers(people: readonly Person[], rrCursor: number): Person[] {
  const members = people
    .filter((p): p is Person & { position: number } => p.position !== null)
    .sort((a, b) => a.position - b.position);
  const start = members.findIndex((p) => p.position > rrCursor);
  return start <= 0 ? members : [...members.slice(start), ...members.slice(0, start)];
}

/**
 * 03 §4 step 5: the dominant skip reason among real candidates (current_owner / already_tried are
 * not "nobody available" signals). Ties prefer no_available > all_at_capacity > no_skill_match.
 */
export function dominantAwaitingReason(trace: RoutingTrace): AwaitingReason {
  const counts: Record<'no_available' | 'all_at_capacity' | 'no_skill_match', number> = {
    no_available: 0,
    all_at_capacity: 0,
    no_skill_match: 0,
  };
  for (const e of trace) {
    if (e.outcome !== 'skipped' || e.reason === 'current_owner' || e.reason === 'already_tried') continue;
    counts[
      e.reason === 'at_capacity'
        ? 'all_at_capacity'
        : e.reason === 'no_skill'
          ? 'no_skill_match'
          : 'no_available'
    ]++;
  }
  if (counts.all_at_capacity > counts.no_available && counts.all_at_capacity >= counts.no_skill_match)
    return 'all_at_capacity';
  if (counts.no_skill_match > counts.no_available && counts.no_skill_match > counts.all_at_capacity)
    return 'no_skill_match';
  return 'no_available';
}

/** 03 §4 step 6: active team manager, else the workspace Owner. Ignores availability. */
export function fallbackCustodian(
  team: TeamConfig,
  people: readonly Person[],
  workspaceOwnerUserId: UserId,
): { userId: UserId; name: string; basis: 'team_manager' | 'workspace_owner' } {
  const manager = team.managerUserId ? people.find((p) => p.userId === team.managerUserId) : undefined;
  if (manager?.isActive) return { userId: manager.userId, name: manager.name, basis: 'team_manager' };
  const owner = people.find((p) => p.userId === workspaceOwnerUserId);
  return { userId: workspaceOwnerUserId, name: owner?.name ?? '', basis: 'workspace_owner' };
}

function levelTargetUserId(level: EscalationLevel, team: TeamConfig): UserId | null {
  switch (level.targetType) {
    case 'user':
      return level.targetUserId;
    case 'team_backup':
      return team.backupUserId;
    case 'team_manager':
      return team.managerUserId;
    case 'next_eligible':
      return null;
  }
}

/** Choose a handler without falling back. Used per escalation level and by `route()`. */
export function selectHandler(input: RouteInput): SelectResult {
  const opts: EligibilityOptions = {
    team: input.team,
    flags: input.flags,
    requiredSkills: input.requiredSkills,
    requireMembership: true,
  };
  const levelNo = input.level?.position;
  const tried = new Set(input.triedThisCycle ?? []);
  const exclude = (p: Person): SkipReason | null => {
    if (input.mode === 'escalation' && tried.has(p.userId) && p.userId !== input.currentOwnerUserId)
      return 'already_tried';
    if (p.userId === input.currentOwnerUserId) return 'current_owner';
    return null;
  };
  const trace: RoutingTrace = [];

  // Named target (03 §4 step 3): exactly one user; a skip means "try the next level".
  if (input.level && input.level.targetType !== 'next_eligible') {
    const targetId = levelTargetUserId(input.level, input.team);
    const target = targetId ? input.people.find((p) => p.userId === targetId) : undefined;
    if (!target) {
      trace.push({ outcome: 'skipped', userId: targetId, name: null, reason: 'no_target', level: levelNo });
      return { kind: 'none', awaitingReason: 'no_available', trace };
    }
    const why = ineligibilityReason(target, { ...opts, requireMembership: false }) ?? exclude(target);
    if (why) {
      trace.push(skipEntry(target, why, opts, levelNo));
      return { kind: 'none', awaitingReason: dominantAwaitingReason(trace), trace };
    }
    trace.push({
      outcome: 'chosen',
      userId: target.userId,
      name: target.name,
      reason: 'level_target',
      level: levelNo,
    });
    return { kind: 'assign', toUserId: target.userId, newRrCursor: null, trace };
  }

  for (const p of rotateMembers(input.people, input.team.rrCursor)) {
    const why = ineligibilityReason(p, opts) ?? exclude(p);
    if (why) {
      trace.push(skipEntry(p, why, opts, levelNo));
      continue;
    }
    const chosen: TraceEntry = {
      outcome: 'chosen',
      userId: p.userId,
      name: p.name,
      reason: 'round_robin_next',
    };
    if (levelNo !== undefined) chosen.level = levelNo;
    trace.push(chosen);
    return { kind: 'assign', toUserId: p.userId, newRrCursor: p.position, trace };
  }
  return { kind: 'none', awaitingReason: dominantAwaitingReason(trace), trace };
}

function fallbackReasonFor(mode: RouteMode, dominant: AwaitingReason): AwaitingReason {
  if (mode === 'absence') return 'owner_absent';
  if (mode === 'deactivation') return 'owner_deactivated';
  return dominant;
}

/**
 * Full routing decision (03 §4): assign an eligible handler, broadcast a claim (P1 first-to-claim,
 * intake/retry only), or fall back to custody. Never returns "nobody".
 */
export function route(input: RouteInput): RoutingDecision {
  const custodian = fallbackCustodian(input.team, input.people, input.workspaceOwnerUserId);
  const firstToClaim =
    input.flags.firstToClaim &&
    input.team.routingMode === 'first_to_claim' &&
    (input.mode === 'intake' || input.mode === 'retry');

  if (firstToClaim) {
    const opts: EligibilityOptions = {
      team: input.team,
      flags: input.flags,
      requiredSkills: input.requiredSkills,
      requireMembership: true,
    };
    const trace: RoutingTrace = [];
    const notify: UserId[] = [];
    for (const p of rotateMembers(input.people, input.team.rrCursor)) {
      const why = ineligibilityReason(p, opts);
      if (why) trace.push(skipEntry(p, why, opts));
      else {
        trace.push({ outcome: 'broadcast', userId: p.userId, name: p.name, reason: 'eligible_claimant' });
        notify.push(p.userId);
      }
    }
    const awaitingReason = notify.length ? 'first_to_claim_pending' : dominantAwaitingReason(trace);
    trace.push({
      outcome: 'fallback',
      userId: custodian.userId,
      name: custodian.name,
      reason: custodian.basis,
      awaitingReason,
    });
    return notify.length
      ? { kind: 'broadcast_claim', fallbackUserId: custodian.userId, notifyUserIds: notify, trace }
      : { kind: 'fallback', toUserId: custodian.userId, reason: awaitingReason, trace };
  }

  const sel = selectHandler(input);
  if (sel.kind === 'assign') {
    return {
      kind: 'assign',
      toUserId: sel.toUserId,
      custody: 'handler',
      newRrCursor: sel.newRrCursor,
      trace: sel.trace,
    };
  }
  const reason = fallbackReasonFor(input.mode, sel.awaitingReason);
  const trace: RoutingTrace = [
    ...sel.trace,
    {
      outcome: 'fallback',
      userId: custodian.userId,
      name: custodian.name,
      reason: custodian.basis,
      awaitingReason: reason,
    },
  ];
  return { kind: 'fallback', toUserId: custodian.userId, reason, trace };
}
