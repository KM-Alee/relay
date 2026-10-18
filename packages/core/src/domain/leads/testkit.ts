// Test fixtures for the lead domain (used by *.test.ts only; not exported from index.ts).
import type { EngineContext } from './transitions';
import {
  P0_FLAGS,
  type EngineFlags,
  type EscalationPolicy,
  type LeadSnapshot,
  type Person,
  type TeamConfig,
} from './types';

export const T0 = new Date('2026-10-18T10:00:00.000Z');
export const at = (s: number) => new Date(T0.getTime() + s * 1000);
/** Plain deadline (no warp). */
export const plainDeadline = (from: Date, s: number) => new Date(from.getTime() + s * 1000);

export const OWNER = 'u-owner';
export const MANAGER = 'u-mgr';
export const BACKUP = 'u-backup';

export function person(userId: string, over: Partial<Person> = {}): Person {
  return {
    userId,
    name: userId.replace(/^u-/, ''),
    isActive: true,
    availability: 'available',
    openHandlerCount: 0,
    capacity: null,
    skills: [],
    position: null,
    ...over,
  };
}

export const member = (userId: string, position: number, over: Partial<Person> = {}) =>
  person(userId, { position, ...over });

export function team(over: Partial<TeamConfig> = {}): TeamConfig {
  return {
    id: 'team-1',
    managerUserId: MANAGER,
    backupUserId: BACKUP,
    routingMode: 'round_robin',
    rrCursor: 0,
    defaultCapacity: 5,
    skillsRouting: false,
    ackWindowSeconds: 120,
    urgentAckWindowSeconds: 45,
    routingRetrySeconds: 30,
    idleSeconds: 600,
    idleRetriggerEnabled: false,
    ...over,
  };
}

/** Default demo policy (03 §3): L1 next → L2 next → L3 backup → L4 manager, repeat 1. */
export function policy(over: Partial<EscalationPolicy> = {}): EscalationPolicy {
  return {
    id: 'pol-1',
    repeatCount: 1,
    levels: [
      { position: 1, targetType: 'next_eligible', targetUserId: null, timeoutSeconds: 120 },
      { position: 2, targetType: 'next_eligible', targetUserId: null, timeoutSeconds: 120 },
      { position: 3, targetType: 'team_backup', targetUserId: null, timeoutSeconds: 90 },
      { position: 4, targetType: 'team_manager', targetUserId: null, timeoutSeconds: 90 },
    ],
    ...over,
  };
}

/** Default people: three members a/b/c, a non-member backup and manager, the workspace Owner. */
export function people(over: Record<string, Partial<Person>> = {}): Person[] {
  const base = [
    member('u-a', 1),
    member('u-b', 2),
    member('u-c', 3),
    person(BACKUP),
    person(MANAGER),
    person(OWNER),
  ];
  return base.map((p) => ({ ...p, ...(over[p.userId] ?? {}) }));
}

export function ctx(over: Partial<EngineContext> & { flagsOver?: Partial<EngineFlags> } = {}): EngineContext {
  const { flagsOver, ...rest } = over;
  return {
    now: T0,
    deadline: plainDeadline,
    team: team(),
    policy: policy(),
    people: people(),
    workspaceOwnerUserId: OWNER,
    flags: { ...P0_FLAGS, ...flagsOver },
    ...rest,
  };
}

export function lead(over: Partial<LeadSnapshot> = {}): LeadSnapshot {
  return {
    id: 'lead-1',
    workspaceId: 'ws-1',
    teamId: 'team-1',
    status: 'open',
    closedReason: null,
    ownerUserId: 'u-a',
    custody: 'handler',
    awaitingHandler: false,
    awaitingReason: null,
    ackStatus: 'pending',
    acknowledgedAt: null,
    acknowledgedVia: null,
    firstAssignedAt: T0,
    assignedAt: T0,
    firstAcknowledgedAt: null,
    lastHumanActionAt: null,
    isUrgent: false,
    isCritical: false,
    escalationLevel: 1,
    escalationCycle: 0,
    escalationCount: 0,
    idleRetriggerCount: 0,
    overdueAttemptCount: 0,
    ackWindowEndsAt: at(120),
    escalateAt: at(120),
    routingRetryAt: null,
    idleCheckAt: null,
    baseWindowEndsAt: at(120),
    version: 3,
    ...over,
  };
}
