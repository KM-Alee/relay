import { describe, expect, it } from 'vitest';
import {
  dominantAwaitingReason,
  fallbackCustodian,
  ineligibilityReason,
  route,
  type RouteInput,
} from './route';
import { BACKUP, MANAGER, OWNER, member, people, person, team } from './testkit';
import { P0_FLAGS, type Person, type SkipReason } from './types';

const input = (over: Partial<RouteInput> = {}): RouteInput => ({
  team: team(),
  people: people(),
  workspaceOwnerUserId: OWNER,
  flags: P0_FLAGS,
  mode: 'intake',
  ...over,
});

describe('route (T-121)', () => {
  const skipCases: { name: string; reason: SkipReason; over: Partial<Person> }[] = [
    { name: 'inactive', reason: 'inactive', over: { isActive: false } },
    { name: 'on leave', reason: 'on_leave', over: { availability: 'on_leave' } },
    { name: 'offline', reason: 'offline', over: { availability: 'offline' } },
    { name: 'busy', reason: 'busy', over: { availability: 'busy' } },
    { name: 'at capacity', reason: 'at_capacity', over: { openHandlerCount: 5 } },
  ];
  it.each(skipCases)('[F3.3] [F3.5] [F3.11] skips $name and records the reason', ({ reason, over }) => {
    const d = route(input({ people: people({ 'u-a': over }) }));
    expect(d).toMatchObject({ kind: 'assign', toUserId: 'u-b', newRrCursor: 2 });
    expect(d.trace[0]).toMatchObject({ outcome: 'skipped', userId: 'u-a', reason });
    expect(d.trace[1]).toMatchObject({ outcome: 'chosen', userId: 'u-b', reason: 'round_robin_next' });
  });

  it('[F3.11] at_capacity entry carries n/capacity for the trace sentence', () => {
    const d = route(input({ people: people({ 'u-a': { openHandlerCount: 5 } }) }));
    expect(d.trace[0]).toMatchObject({ openCount: 5, capacity: 5 });
  });

  it('[F3.3d] skips no_skill only when skill routing flag and team setting are on', () => {
    const ppl = people({ 'u-a': { skills: ['en'] }, 'u-b': { skills: ['ur'] } });
    const on = route(
      input({
        people: ppl,
        requiredSkills: ['ur'],
        flags: { ...P0_FLAGS, skillsRouting: true },
        team: team({ skillsRouting: true }),
      }),
    );
    expect(on.trace[0]).toMatchObject({ userId: 'u-a', reason: 'no_skill' });
    expect(on).toMatchObject({ toUserId: 'u-b' });
    expect(route(input({ people: ppl, requiredSkills: ['ur'] }))).toMatchObject({ toUserId: 'u-a' });
  });

  it('[F3.3e] per-employee capacity only with the flag', () => {
    const ppl = people({ 'u-a': { capacity: 1, openHandlerCount: 1 } });
    expect(route(input({ people: ppl }))).toMatchObject({ toUserId: 'u-a' });
    expect(route(input({ people: ppl, flags: { ...P0_FLAGS, perEmployeeCapacity: true } }))).toMatchObject({
      toUserId: 'u-b',
    });
  });

  it('[F3.5] escalation skips current_owner and already_tried', () => {
    const d = route(input({ mode: 'escalation', currentOwnerUserId: 'u-a', triedThisCycle: ['u-b'] }));
    expect(d.trace.map((e) => e.outcome === 'skipped' && e.reason)).toEqual([
      'current_owner',
      'already_tried',
      false,
    ]);
    expect(d).toMatchObject({ toUserId: 'u-c' });
  });

  it('[F3.3] not_member applies to rotation-style checks (manual reassign, claims)', () => {
    const o = { team: team(), flags: P0_FLAGS, requireMembership: true };
    expect(ineligibilityReason(person('u-x'), o)).toBe('not_member');
    expect(ineligibilityReason(person('u-x'), { ...o, requireMembership: false })).toBeNull();
  });

  it('[F3.3a] round-robin rotates after rr_cursor and wraps', () => {
    const picks = [0, 1, 2, 3].map((cursor) => route(input({ team: team({ rrCursor: cursor }) })));
    expect(picks.map((d) => d.kind === 'assign' && d.toUserId)).toEqual(['u-a', 'u-b', 'u-c', 'u-a']);
  });

  it('[F3.3] round-robin ignores non-members (manager, backup, Owner never in rotation)', () => {
    const ppl = [
      member('u-a', 1, { availability: 'offline' }),
      person(MANAGER),
      person(BACKUP),
      person(OWNER),
    ];
    expect(route(input({ people: ppl }))).toMatchObject({ kind: 'fallback', toUserId: MANAGER });
  });

  const fallbackCases = [
    { name: 'active manager', mgr: {}, managerUserId: MANAGER, expected: MANAGER, basis: 'team_manager' },
    {
      name: 'unavailable manager (custody ignores availability)',
      mgr: { availability: 'on_leave' as const },
      managerUserId: MANAGER,
      expected: MANAGER,
      basis: 'team_manager',
    },
    {
      name: 'inactive manager → Owner',
      mgr: { isActive: false },
      managerUserId: MANAGER,
      expected: OWNER,
      basis: 'workspace_owner',
    },
    { name: 'no manager → Owner', mgr: {}, managerUserId: null, expected: OWNER, basis: 'workspace_owner' },
  ];
  it.each(fallbackCases)('[F3.5] fallback custodian: $name', ({ mgr, managerUserId, expected, basis }) => {
    const t = team({ managerUserId });
    const ppl = people({
      'u-a': { availability: 'offline' },
      'u-b': { availability: 'offline' },
      'u-c': { availability: 'offline' },
      [MANAGER]: mgr,
    });
    expect(fallbackCustodian(t, ppl, OWNER)).toMatchObject({ userId: expected, basis });
    const d = route(input({ team: t, people: ppl }));
    expect(d).toMatchObject({ kind: 'fallback', toUserId: expected, reason: 'no_available' });
    expect(d.trace.at(-1)).toMatchObject({ outcome: 'fallback', userId: expected, reason: basis });
  });

  const reasonCases = [
    {
      name: 'everyone offline',
      over: { availability: 'offline' as const },
      mixed: undefined,
      expected: 'no_available',
    },
    {
      name: 'everyone at capacity',
      over: { openHandlerCount: 9 },
      mixed: undefined,
      expected: 'all_at_capacity',
    },
    {
      name: '2 at capacity, 1 offline',
      over: { openHandlerCount: 9 },
      mixed: { availability: 'offline' as const },
      expected: 'all_at_capacity',
    },
  ];
  it.each(reasonCases)('[F3.3] awaiting reason when nobody eligible: $name', ({ over, mixed, expected }) => {
    const ppl = people({ 'u-a': over, 'u-b': over, 'u-c': mixed ?? over });
    expect(route(input({ people: ppl }))).toMatchObject({ kind: 'fallback', reason: expected });
  });

  it('[F3.3] dominant reason: skills wins only by count; empty team → no_available', () => {
    expect(dominantAwaitingReason([])).toBe('no_available');
    const s = (reason: SkipReason) => ({ outcome: 'skipped' as const, userId: 'x', name: 'x', reason });
    expect(dominantAwaitingReason([s('no_skill'), s('no_skill'), s('busy')])).toBe('no_skill_match');
    expect(dominantAwaitingReason([s('at_capacity'), s('busy')])).toBe('no_available');
  });

  it('[F3.6] [F1.8] absence / deactivation fallback reasons', () => {
    const ppl = people({ 'u-b': { availability: 'offline' }, 'u-c': { availability: 'offline' } });
    expect(route(input({ mode: 'absence', people: ppl, currentOwnerUserId: 'u-a' }))).toMatchObject({
      kind: 'fallback',
      reason: 'owner_absent',
    });
    expect(route(input({ mode: 'deactivation', people: ppl, currentOwnerUserId: 'u-a' }))).toMatchObject({
      kind: 'fallback',
      reason: 'owner_deactivated',
    });
  });

  it('[F3.3c] first-to-claim broadcasts only behind the flag', () => {
    const t = team({ routingMode: 'first_to_claim' });
    expect(route(input({ team: t }))).toMatchObject({ kind: 'assign' });
    const d = route(
      input({
        team: t,
        flags: { ...P0_FLAGS, firstToClaim: true },
        people: people({ 'u-b': { availability: 'busy' } }),
      }),
    );
    expect(d).toMatchObject({
      kind: 'broadcast_claim',
      fallbackUserId: MANAGER,
      notifyUserIds: ['u-a', 'u-c'],
    });
  });
});
