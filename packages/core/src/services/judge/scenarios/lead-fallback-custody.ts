// F3.4 / rubric 3: nobody is available, the lead still has an accountable human (fallback custody).
import { activeUsers, closeJudgeLead, judgeIntake, leadRow, restoreAvail, setAvail } from '../lead-helpers';
import { fail, pass, pending, type JudgeScenario } from '../types';

export const leadFallbackCustody: JudgeScenario = {
  id: 'lead-fallback-custody',
  criterion: 3,
  reqs: ['F3.4', 'INV-1'],
  expected: 'Everyone offline: the lead goes to the fallback custodian (never ownerless) and shows why',
  async run({ actor, step }) {
    const ws = actor.workspaceId;
    const users = await activeUsers(ws);
    if (!users.length) return pending('pending: no active users');
    let leadId: string | null = null;
    try {
      for (const u of users) await setAvail(ws, u.id, 'offline');
      step('Everyone set Offline', true, `${users.length} user(s)`);
      const out = await judgeIntake(actor, 'fallback');
      leadId = out.leadId;
      const row = await leadRow(ws, leadId);
      const owned = !!row?.owner_user_id;
      const custody = row?.custody === 'fallback';
      const reason = !!row?.awaiting_reason;
      step('Lead has an owner', owned, row?.owner_user_id);
      step('Custody is fallback', custody, row?.custody);
      step('Awaiting reason recorded', reason, row?.awaiting_reason ?? '');
      const actual = `owner=${row?.owner_user_id}; custody=${row?.custody}; awaiting_reason=${row?.awaiting_reason}`;
      const evidence = [{ key: 'team' as const, href: `/leads/${leadId}` }];
      return owned && custody && reason ? pass(actual, evidence) : fail(actual, evidence);
    } finally {
      await restoreAvail(ws, users);
      if (leadId) await closeJudgeLead(ws, leadId);
    }
  },
};
