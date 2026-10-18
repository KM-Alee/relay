// F3.8 / rubric 3: two timers firing at once escalate exactly once.
import { withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { processLeadTimer } from '../../leads';
import { activeUsers, closeJudgeLead, judgeIntake, leadRow, restoreAvail, setAvail } from '../lead-helpers';
import { fail, pass, pending, type JudgeScenario } from '../types';

export const leadTimersOnce: JudgeScenario = {
  id: 'lead-timers-once',
  criterion: 3,
  reqs: ['F3.8', 'INV-3'],
  expected:
    'A lead past its escalation deadline, processed by two workers at once, gets exactly 1 escalation event',
  async run({ actor, step }) {
    const ws = actor.workspaceId;
    const users = await activeUsers(ws);
    if (users.length < 2) return pending('pending: needs at least 2 active users');
    let leadId: string | null = null;
    try {
      for (const u of users) await setAvail(ws, u.id, 'available');
      const out = await judgeIntake(actor, 'timers');
      leadId = out.leadId;
      const id = leadId;
      await withWorkspaceTx(ws, (tx) =>
        tx.execute(
          sql`update leads set escalate_at = now() - interval '1 minute', version = version + 1 where id = ${id}::uuid`,
        ),
      );
      step('Lead past its escalation deadline', true);
      const before = (await leadRow(ws, id))?.escalation_count ?? 0;
      const results = await Promise.all([processLeadTimer(ws, id), processLeadTimer(ws, id)]);
      const after = (await leadRow(ws, id))?.escalation_count ?? 0;
      const events = await withWorkspaceTx(ws, async (tx) =>
        Number(
          (
            await tx.execute<{ n: string }>(
              sql`select count(*) n from lead_events where lead_id = ${id}::uuid and type = 'escalation'`,
            )
          ).rows[0]?.n ?? 0,
        ),
      );
      step('Two concurrent timer runs', true, results.join(', '));
      const ok = after - before === 1 && events === 1;
      step('escalation_count incremented exactly once', ok, `${before} -> ${after}; events=${events}`);
      const actual = `results=[${results.join(',')}]; escalation_count ${before}->${after}; escalation events=${events}`;
      const evidence = [{ key: 'team' as const, href: `/leads/${id}` }];
      return ok ? pass(actual, evidence) : fail(actual, evidence);
    } finally {
      await restoreAvail(ws, users);
      if (leadId) await closeJudgeLead(ws, leadId);
    }
  },
};
