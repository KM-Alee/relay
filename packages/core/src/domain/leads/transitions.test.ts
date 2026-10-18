import { describe, expect, it } from 'vitest';
import { classifyRecovery, compareRecovery } from './recovery';
import { MANAGER, OWNER, T0, at, ctx, lead, people, policy, team } from './testkit';
import {
  REJECTION_ERROR,
  acknowledge,
  canDeactivateUser,
  claim,
  closeLead,
  escalateOnAckTimeout,
  idleRetrigger,
  intake,
  leadStateLabel,
  manualReassign,
  reassignOnAbsence,
  recordHumanAction,
  retryRouting,
  transferOnDeactivation,
  type Applied,
  type TransitionResult,
} from './transitions';
import type { LeadSnapshot, Person } from './types';

const SYS = { type: 'system' } as const;
const ok = (r: TransitionResult): Applied => {
  if (!r.ok) throw new Error(`rejected: ${r.code}`);
  return r;
};
const allOff = (extra: Record<string, Partial<Person>> = {}) =>
  people({
    'u-a': { availability: 'offline' },
    'u-b': { openHandlerCount: 5 },
    'u-c': { availability: 'on_leave' },
    ...extra,
  });
const types = (r: Applied) => r.events.map((e) => e.type);

describe('T1 intake', () => {
  it('[§10a] [F3.3] [F3.5] everyone offline or at capacity → one active human owner + awaiting reason', () => {
    const r = intake(ctx({ people: allOff({ [MANAGER]: { availability: 'offline' } }) }), {
      id: 'l',
      workspaceId: 'w',
      actor: SYS,
    });
    expect(r.next).toMatchObject({
      ownerUserId: MANAGER,
      custody: 'fallback',
      awaitingHandler: true,
      awaitingReason: 'no_available',
    });
    expect(r.next.routingRetryAt).toEqual(at(30));
    expect(r.next.escalateAt).toEqual(at(120));
    expect(r.notifications).toEqual([expect.objectContaining({ userId: MANAGER, type: 'lead.assigned' })]);
    expect(r.outbox[0]).toMatchObject({ type: 'slack.send', dedupeKey: 'sl:assigned:l:0:u-mgr' });
  });

  it('[F3.1] [F3.3] assigns by round-robin with deadlines from the time-warp deadline fn', () => {
    const warp10 = (from: Date, s: number) => new Date(from.getTime() + (s * 1000) / 10);
    const r = intake(ctx({ deadline: warp10 }), { id: 'l', workspaceId: 'w', actor: SYS });
    expect(r.next).toMatchObject({
      ownerUserId: 'u-a',
      custody: 'handler',
      escalationLevel: 1,
      escalationCount: 0,
    });
    expect(r.next.escalateAt).toEqual(at(12));
    expect(r.next.baseWindowEndsAt).toEqual(at(12));
    expect(r.newRrCursor).toBe(1);
    expect(types(r)).toEqual(['intake_assigned']);
  });

  it('[F3.12] urgent window only with the flag', () => {
    const c = ctx({ flagsOver: { urgentWindows: true } });
    expect(intake(c, { id: 'l', workspaceId: 'w', actor: SYS, isUrgent: true }).next.escalateAt).toEqual(
      at(45),
    );
    expect(intake(ctx(), { id: 'l', workspaceId: 'w', actor: SYS, isUrgent: true }).next.escalateAt).toEqual(
      at(120),
    );
  });
});

describe('T2 acknowledge / T10 human action', () => {
  it('[F3.4] owner ack clears timers, sets first ack, hands off AI', () => {
    const r = ok(acknowledge(ctx({ now: at(10) }), lead(), { actorUserId: 'u-a', via: 'app' }));
    expect(r.next).toMatchObject({
      ackStatus: 'acknowledged',
      escalateAt: null,
      ackWindowEndsAt: null,
      firstAcknowledgedAt: at(10),
      version: 4,
    });
    expect(r.outbox).toEqual([expect.objectContaining({ type: 'ai.handoff' })]);
    expect(r.patch).not.toHaveProperty('version');
  });

  const rejections = [
    { name: 'non-owner', l: {}, actor: 'u-b', code: 'NOT_OWNER' },
    {
      name: 'fallback custodian',
      l: { ownerUserId: MANAGER, custody: 'fallback' as const, awaitingHandler: true },
      actor: MANAGER,
      code: 'FALLBACK_CUSTODY',
    },
    {
      name: 'already acked',
      l: { ackStatus: 'acknowledged' as const, acknowledgedAt: T0 },
      actor: 'u-a',
      code: 'ALREADY_ACKNOWLEDGED',
    },
    { name: 'closed', l: { status: 'closed' as const }, actor: 'u-a', code: 'LEAD_CLOSED' },
  ];
  it.each(rejections)(
    '[F3.4] ack by $name → $code (409 LEAD_STATE_CHANGED), no change',
    ({ l, actor, code }) => {
      const r = acknowledge(ctx(), lead(l), { actorUserId: actor, via: 'app' });
      expect(r).toMatchObject({ ok: false, code });
      if (!r.ok) expect(REJECTION_ERROR[r.code]).toBe('LEAD_STATE_CHANGED');
    },
  );

  it('[I4.5] stale Slack ack (version moved) is rejected', () => {
    expect(
      acknowledge(ctx(), lead(), { actorUserId: 'u-a', via: 'slack', expectedVersion: 2 }),
    ).toMatchObject({ code: 'STALE_VERSION' });
  });

  it('[F2.13] owner action auto-acks; non-owner and fallback custodian actions do not', () => {
    expect(
      ok(recordHumanAction(ctx(), lead(), { actorUserId: 'u-a', action: 'note' })).next.acknowledgedVia,
    ).toBe('action:note');
    expect(ok(recordHumanAction(ctx(), lead(), { actorUserId: 'u-b', action: 'note' })).changed).toBe(false);
    const fb = lead({ ownerUserId: MANAGER, custody: 'fallback', awaitingHandler: true });
    expect(ok(recordHumanAction(ctx(), fb, { actorUserId: MANAGER, action: 'call' })).changed).toBe(false);
  });
});

describe('T3 escalation', () => {
  const due = ctx({ now: at(120) });

  it('[F3.5] [F3.8] [F3.9] [§10d] ack timeout transfers to next eligible and increments escalation_count only', () => {
    const r = ok(escalateOnAckTimeout(due, lead()));
    expect(r.next).toMatchObject({
      ownerUserId: 'u-b',
      escalationCount: 1,
      escalationLevel: 2,
      overdueAttemptCount: 0,
      idleRetriggerCount: 0,
    });
    expect(r.next.escalateAt).toEqual(at(240));
    expect(r.next.firstAssignedAt).toEqual(T0);
    expect(types(r)).toEqual(['escalation']);
    expect(r.outbox[0]).toMatchObject({
      type: 'slack.send',
      payload: { userId: 'u-b', purpose: 'escalated', leadVersion: 4 },
    });
  });

  it('[F3.8] guard: not due / acknowledged / closed → no-op', () => {
    expect(escalateOnAckTimeout(ctx({ now: at(119) }), lead())).toMatchObject({ ok: false, code: 'NOT_DUE' });
    expect(escalateOnAckTimeout(due, lead({ ackStatus: 'acknowledged', acknowledgedAt: T0 }))).toMatchObject({
      ok: false,
    });
    expect(escalateOnAckTimeout(due, lead({ status: 'closed' }))).toMatchObject({ ok: false });
  });

  it('[F3.5] skipped named backup is recorded and the chain moves to the manager level', () => {
    const c = ctx({ now: at(120), people: people({ 'u-backup': { availability: 'on_leave' } }) });
    const r = ok(escalateOnAckTimeout(c, lead({ escalationLevel: 2, ownerUserId: 'u-b' })));
    expect(r.next).toMatchObject({ ownerUserId: MANAGER, escalationLevel: 4, escalationCount: 1 });
    expect(r.events[0]!.trace).toContainEqual(
      expect.objectContaining({ userId: 'u-backup', reason: 'on_leave', level: 3 }),
    );
  });

  it('[F3.5] [§10d] window expiry with nobody eligible → overdue attempt in fallback custody, not an escalation', () => {
    const c = ctx({
      now: at(120),
      policy: policy({ repeatCount: 2, levels: policy().levels.slice(0, 2) }),
      people: allOff({ 'u-a': {} }),
    });
    const r = ok(escalateOnAckTimeout(c, lead()));
    expect(r.next).toMatchObject({
      ownerUserId: MANAGER,
      custody: 'fallback',
      escalationCount: 0,
      overdueAttemptCount: 1,
      isCritical: false,
      escalationCycle: 1,
      escalationLevel: 0,
    });
    expect(r.next.routingRetryAt).toEqual(at(150));
    expect(types(r)).toEqual(['overdue_attempt']);
  });

  it('[F3.5] [§10c] end of chain → critical, custodian alerted even when unavailable, retries continue', () => {
    const c = ctx({
      now: at(120),
      people: allOff({ [MANAGER]: { availability: 'offline' }, 'u-backup': { availability: 'offline' } }),
    });
    const r = ok(escalateOnAckTimeout(c, lead()));
    expect(r.next).toMatchObject({
      ownerUserId: MANAGER,
      isCritical: true,
      awaitingReason: 'chain_exhausted',
      escalationCount: 0,
    });
    expect(types(r)).toEqual(['overdue_attempt', 'critical_flagged']);
    expect(r.notifications.map((n) => n.type)).toContain('lead.critical');
    expect(r.next.routingRetryAt).toEqual(at(150));
    expect(r.next.escalateAt).toEqual(at(150));

    // A later expiry while exhausted: nobody → reschedule; someone back → routing_retry_assigned (not escalation).
    const again = ok(escalateOnAckTimeout({ ...c, now: at(150) }, r.next));
    expect(again.next).toMatchObject({ ownerUserId: MANAGER, overdueAttemptCount: 1, isCritical: true });
    expect(again.events).toEqual([]);
    const back = ok(escalateOnAckTimeout({ ...c, now: at(180), people: people() }, again.next));
    expect(back.next).toMatchObject({ custody: 'handler', escalationCount: 0, isCritical: false });
    expect(types(back)).toEqual(['routing_retry_assigned', 'critical_cleared']);
  });
});

describe('T4 routing retry', () => {
  const waiting = lead({
    ownerUserId: MANAGER,
    custody: 'fallback',
    awaitingHandler: true,
    awaitingReason: 'no_available',
    routingRetryAt: at(30),
  });

  it('[F3.3] assigns when someone becomes available; not an escalation; first_assigned_at kept', () => {
    const r = ok(retryRouting(ctx({ now: at(30) }), waiting));
    expect(r.next).toMatchObject({
      ownerUserId: 'u-a',
      custody: 'handler',
      awaitingHandler: false,
      escalationCount: 0,
      firstAssignedAt: T0,
    });
    expect(types(r)).toEqual(['routing_retry_assigned']);
  });

  it('[F3.3] still nobody → custodian keeps custody, retry rescheduled (retries never stop)', () => {
    const r = ok(retryRouting(ctx({ now: at(30), people: allOff() }), waiting));
    expect(r.next).toMatchObject({ ownerUserId: MANAGER, awaitingReason: 'no_available' });
    expect(r.next.routingRetryAt).toEqual(at(60));
    expect(retryRouting(ctx({ now: at(29) }), waiting)).toMatchObject({ ok: false, code: 'NOT_DUE' });
    expect(retryRouting(ctx({ now: at(29) }), waiting, { kicked: true })).toMatchObject({ ok: true });
  });
});

describe('T5 absence / T6 deactivation', () => {
  it('[F3.6] pending lead moves; acknowledged lead stays with banner; fallback custody stays', () => {
    const c = ctx({ people: people({ 'u-a': { availability: 'on_leave' } }) });
    const r = ok(reassignOnAbsence(c, lead(), { userId: 'u-a', availability: 'on_leave', actor: SYS }));
    expect(r.next).toMatchObject({ ownerUserId: 'u-b', escalationCount: 0 });
    expect(types(r)).toEqual(['absence_reassign']);
    const acked = lead({ ackStatus: 'acknowledged', acknowledgedAt: T0 });
    expect(
      ok(reassignOnAbsence(c, acked, { userId: 'u-a', availability: 'on_leave', actor: SYS })),
    ).toMatchObject({ changed: false, kept: 'acknowledged_owner_absent' });
    expect(reassignOnAbsence(c, lead(), { userId: 'u-a', availability: 'busy', actor: SYS })).toMatchObject({
      ok: false,
    });
  });

  it('[F3.6] [§10c] absence with nobody eligible → fallback custody owner_absent', () => {
    const c = ctx({ people: allOff({ 'u-a': { availability: 'offline' } }) });
    const r = ok(reassignOnAbsence(c, lead(), { userId: 'u-a', availability: 'offline', actor: SYS }));
    expect(r.next).toMatchObject({
      ownerUserId: MANAGER,
      custody: 'fallback',
      awaitingReason: 'owner_absent',
    });
  });

  it('[F1.8] [§10c] deactivation moves acknowledged leads and fallback custody; never to an inactive owner', () => {
    const acked = lead({ ackStatus: 'acknowledged', acknowledgedAt: T0, firstAcknowledgedAt: T0 });
    const r = ok(transferOnDeactivation(ctx(), acked, { userId: 'u-a', actor: SYS }));
    expect(r.next).toMatchObject({ ownerUserId: 'u-b', ackStatus: 'pending', firstAcknowledgedAt: T0 });
    expect(types(r)).toEqual(['deactivation_reassign']);
    const custody = lead({ ownerUserId: MANAGER, custody: 'fallback', awaitingHandler: true });
    const r2 = ok(
      transferOnDeactivation(ctx({ people: allOff() }), custody, { userId: MANAGER, actor: SYS }),
    );
    expect(r2.next).toMatchObject({ ownerUserId: OWNER, awaitingReason: 'owner_deactivated' });
  });

  it('[F1.8] cannot deactivate the workspace Owner or a configured team manager', () => {
    const teams = [{ id: 't1', managerUserId: MANAGER }];
    expect(canDeactivateUser({ userId: OWNER, workspaceOwnerUserId: OWNER, teams })).toMatchObject({
      ok: false,
      reason: 'workspace_owner',
    });
    expect(canDeactivateUser({ userId: MANAGER, workspaceOwnerUserId: OWNER, teams })).toMatchObject({
      ok: false,
      teamIds: ['t1'],
    });
    expect(canDeactivateUser({ userId: 'u-a', workspaceOwnerUserId: OWNER, teams })).toEqual({ ok: true });
  });
});

describe('T7 manual reassign', () => {
  const busyB = ctx({ people: people({ 'u-b': { availability: 'busy' }, 'u-c': { isActive: false } }) });
  it('[F3] ineligible target needs override + reason; inactive never; fresh window', () => {
    expect(manualReassign(busyB, lead(), { actorUserId: MANAGER, toUserId: 'u-b' })).toMatchObject({
      code: 'TARGET_INELIGIBLE',
      detail: { skipReason: 'busy' },
    });
    expect(
      manualReassign(busyB, lead(), { actorUserId: MANAGER, toUserId: 'u-b', override: { reason: ' ' } }),
    ).toMatchObject({ code: 'OVERRIDE_REASON_REQUIRED' });
    expect(
      manualReassign(busyB, lead(), { actorUserId: MANAGER, toUserId: 'u-c', override: { reason: 'x' } }),
    ).toMatchObject({ code: 'TARGET_INACTIVE' });
    const r = ok(
      manualReassign({ ...busyB, now: at(50) }, lead(), {
        actorUserId: MANAGER,
        toUserId: 'u-b',
        override: { reason: 'VIP' },
      }),
    );
    expect(r.next).toMatchObject({ ownerUserId: 'u-b', ackStatus: 'pending', escalationCount: 0 });
    expect(r.next.escalateAt).toEqual(at(170));
    expect(r.events[0]).toMatchObject({
      type: 'manual_reassign',
      meta: { override: true, overrideReason: 'VIP' },
    });
    expect(r.audit[0]).toMatchObject({ action: 'lead.reassigned' });
  });
});

describe('T8 claims (P1)', () => {
  const pending = lead({
    ownerUserId: MANAGER,
    custody: 'fallback',
    awaitingHandler: true,
    awaitingReason: 'first_to_claim_pending',
  });
  it('[F3.3c] first valid claim transfers + acknowledges; ineligible claim rejected with claim_rejected; flag off → disabled', () => {
    expect(claim(ctx(), pending, { claimerUserId: 'u-a', kind: 'claim' })).toMatchObject({
      code: 'FEATURE_DISABLED',
    });
    const c = ctx({ flagsOver: { firstToClaim: true }, people: people({ 'u-b': { openHandlerCount: 5 } }) });
    const r = ok(claim(c, pending, { claimerUserId: 'u-a', kind: 'claim' }));
    expect(r.next).toMatchObject({
      ownerUserId: 'u-a',
      custody: 'handler',
      ackStatus: 'acknowledged',
      acknowledgedVia: 'claim',
      escalateAt: null,
      routingRetryAt: null,
    });
    const lost = claim(c, pending, { claimerUserId: 'u-b', kind: 'claim' });
    expect(lost).toMatchObject({
      ok: false,
      code: 'CLAIMER_INELIGIBLE',
      events: [expect.objectContaining({ type: 'claim_rejected' })],
    });
    expect(claim(c, r.next, { claimerUserId: 'u-c', kind: 'claim' })).toMatchObject({
      code: 'NOT_CLAIMABLE',
    });
  });
});

describe('T9 idle re-trigger (P1)', () => {
  const acked = lead({
    ackStatus: 'acknowledged',
    acknowledgedAt: T0,
    firstAcknowledgedAt: T0,
    lastHumanActionAt: T0,
    escalateAt: null,
    idleCheckAt: at(600),
    escalationCount: 1,
    escalationLevel: 3,
  });
  const on = ctx({
    now: at(600),
    flagsOver: { idleRetrigger: true },
    team: team({ idleRetriggerEnabled: true }),
  });

  it('[F3.10] [§10d] [§9.7] increments only idle_retrigger_count; first_* and escalation_count unchanged', () => {
    const r = ok(idleRetrigger(on, acked));
    expect(r.next).toMatchObject({
      ownerUserId: 'u-b',
      ackStatus: 'pending',
      idleRetriggerCount: 1,
      escalationCount: 1,
      escalationLevel: 1,
      firstAssignedAt: T0,
      firstAcknowledgedAt: T0,
    });
    expect(types(r)).toEqual(['idle_retrigger']);
    expect(idleRetrigger(ctx({ now: at(600) }), acked)).toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('[F3.10] a later human action reschedules instead of re-triggering', () => {
    const r = ok(idleRetrigger(on, { ...acked, lastHumanActionAt: at(300) }));
    expect(r.next).toMatchObject({ ownerUserId: 'u-a', idleRetriggerCount: 0 });
    expect(r.next.idleCheckAt).toEqual(at(900));
  });
});

describe('T11 close + state label', () => {
  it('[F3] close clears every timer and kicks team routing retry', () => {
    const r = ok(closeLead(ctx(), lead({ routingRetryAt: at(30) }), { reason: 'won', actor: SYS }));
    expect(r.next).toMatchObject({
      status: 'closed',
      escalateAt: null,
      routingRetryAt: null,
      idleCheckAt: null,
      ackWindowEndsAt: null,
    });
    expect(r.wakeAt).toBeNull();
    expect(r.outbox).toEqual([
      expect.objectContaining({ type: 'lead.retry_routing', payload: { teamId: 'team-1' } }),
    ]);
  });

  it('[F3.4] state labels', () => {
    const o = (s: number) => ({ now: at(s), deadline: ctx().deadline, idleSeconds: 600 });
    expect(leadStateLabel(lead(), o(10))).toBe('assignedPending');
    expect(leadStateLabel(lead(), o(121))).toBe('overdue');
    expect(leadStateLabel(lead({ awaitingHandler: true, custody: 'fallback' }), o(10))).toBe(
      'awaitingHandler',
    );
    expect(leadStateLabel(lead({ ackStatus: 'acknowledged', acknowledgedAt: T0 }), o(601))).toBe('idle');
  });
});

describe('recovery R1–R5', () => {
  const o = (s: number) => ({ now: at(s), deadline: ctx().deadline, idleSeconds: 600 });
  const cases: { name: string; l: Partial<LeadSnapshot>; s: number; expected: string[] }[] = [
    { name: 'R1 overdue', l: {}, s: 121, expected: ['overdue'] },
    {
      name: 'R2 escalated twice',
      l: { escalationCount: 2, ackStatus: 'acknowledged', acknowledgedAt: at(100) },
      s: 130,
      expected: ['escalated2'],
    },
    {
      name: 'R2 ignores idle re-triggers',
      l: { escalationCount: 1, idleRetriggerCount: 5, ackStatus: 'acknowledged', acknowledgedAt: at(100) },
      s: 130,
      expected: [],
    },
    {
      name: 'R3 idle',
      l: { ackStatus: 'acknowledged', acknowledgedAt: T0, lastHumanActionAt: at(10) },
      s: 611,
      expected: ['idle'],
    },
    { name: 'R4 awaiting', l: { awaitingHandler: true, custody: 'fallback' }, s: 10, expected: ['awaiting'] },
    {
      name: 'R5 critical',
      l: { isCritical: true, awaitingHandler: true, custody: 'fallback' },
      s: 10,
      expected: ['awaiting', 'critical'],
    },
    { name: 'closed never listed', l: { status: 'closed', isCritical: true }, s: 999, expected: [] },
  ];
  it.each(cases)('[F3.7] $name', ({ l, s, expected }) => {
    expect(classifyRecovery(lead(l), o(s))).toEqual(expected);
  });

  it('[F3.7] sort: critical, urgent, oldest', () => {
    const a = lead({ id: 'a', firstAssignedAt: at(5) });
    const b = lead({ id: 'b', isUrgent: true, firstAssignedAt: at(9) });
    const c = lead({ id: 'c', isCritical: true, firstAssignedAt: at(9) });
    const d = lead({ id: 'd', firstAssignedAt: at(1) });
    expect([a, b, c, d].sort(compareRecovery).map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('ownership invariants under random sequences', () => {
  it('[§10c] [F3.8] owner never null or inactive; escalation_count only moves on escalation events', () => {
    let seed = 42;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    const avail = ['available', 'busy', 'on_leave', 'offline'] as const;
    for (let run = 0; run < 200; run++) {
      const ppl = people(
        Object.fromEntries(
          ['u-a', 'u-b', 'u-c', 'u-backup', MANAGER].map((u) => [
            u,
            { availability: avail[rnd(4)], openHandlerCount: rnd(7) },
          ]),
        ),
      );
      let c = ctx({ people: ppl, policy: policy({ repeatCount: 1 + rnd(2) }) });
      let l = intake(c, { id: 'l', workspaceId: 'w', actor: SYS }).next;
      for (let step = 0; step < 12; step++) {
        c = { ...c, now: new Date(c.now.getTime() + 200_000) };
        const before = l;
        const ops = [
          () => escalateOnAckTimeout(c, l),
          () => retryRouting(c, l, { kicked: true }),
          () => acknowledge(c, l, { actorUserId: l.ownerUserId, via: 'app' }),
          () => reassignOnAbsence(c, l, { userId: l.ownerUserId, availability: 'offline', actor: SYS }),
          () => manualReassign(c, l, { actorUserId: OWNER, toUserId: 'u-a', override: { reason: 'r' } }),
        ];
        const r = ops[rnd(ops.length)]!();
        if (!r.ok) continue;
        l = r.next;
        const owner = c.people.find((p) => p.userId === l.ownerUserId);
        expect(l.ownerUserId).toBeTruthy();
        expect(owner?.isActive).toBe(true);
        expect(l.custody === 'handler' || l.awaitingHandler).toBe(true);
        const escalated = r.events.filter((e) => e.type === 'escalation').length;
        expect(l.escalationCount - before.escalationCount).toBe(escalated);
        expect(l.firstAssignedAt).toEqual(T0);
        if (l.custody === 'fallback') expect(l.ackStatus).toBe('pending');
        if (l.awaitingHandler) expect(l.routingRetryAt).not.toBeNull();
      }
    }
  });
});
