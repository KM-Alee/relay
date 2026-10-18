// F3.6 / rubric 3: marking someone on leave/offline reassigns their leads immediately.
import { setAvailability } from '../../teams';
import { activeUsers, closeJudgeLead, judgeIntake, leadRow, restoreAvail, setAvail } from '../lead-helpers';
import { fail, pass, pending, type JudgeScenario } from '../types';

export const leadAbsenceReassign: JudgeScenario = {
  id: 'lead-absence-reassign',
  criterion: 3,
  reqs: ['F3.6', 'F3.7'],
  expected:
    'Owner set to On leave/Offline: their open leads move to another Available person at once, with the reason recorded',
  async run({ actor, step }) {
    const ws = actor.workspaceId;
    const users = await activeUsers(ws);
    if (users.length < 2) return pending('pending: needs at least 2 active users');
    let leadId: string | null = null;
    try {
      for (const u of users) await setAvail(ws, u.id, 'available');
      const out = await judgeIntake(actor, 'absence');
      leadId = out.leadId;
      const owner = out.ownerUserId;
      step('Lead pending with a handler', out.custody === 'handler', owner);
      const res = await setAvailability(actor, owner, 'offline');
      const row = await leadRow(ws, leadId);
      const moved = res.reassignedLeadIds.includes(leadId) && row?.owner_user_id !== owner;
      step('Owner set Offline, lead reassigned in the same call', moved, `new owner=${row?.owner_user_id}`);
      const actual = `old owner=${owner}; new owner=${row?.owner_user_id}; custody=${row?.custody}; reassigned=${res.reassignedLeadIds.length}`;
      const evidence = [{ key: 'team' as const, href: `/leads/${leadId}` }];
      return moved ? pass(actual, evidence) : fail(actual, evidence);
    } finally {
      await restoreAvail(ws, users);
      if (leadId) await closeJudgeLead(ws, leadId);
    }
  },
};
