// F4.3 / F4.4 / rubric 4: the audit log cannot be edited, and the hash chain proves it.
import { verifyChain } from '../../../audit';
import { withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { fail, pass, type JudgeScenario } from '../types';

async function attempt(workspaceId: string, stmt: ReturnType<typeof sql>): Promise<string | null> {
  try {
    await withWorkspaceTx(workspaceId, (tx) => tx.execute(stmt));
    return null;
  } catch (e) {
    const cause = (e as { cause?: { message?: string } }).cause;
    return String(cause?.message ?? (e as Error).message).slice(0, 120);
  }
}

export const auditTamper: JudgeScenario = {
  id: 'audit-tamper',
  criterion: 4,
  reqs: ['F4.3', 'F4.4'],
  expected:
    'Chain verifies; UPDATE and DELETE on audit_events as app_user are refused; the chain still verifies afterwards',
  async run({ actor, step }) {
    const before = await withWorkspaceTx(actor.workspaceId, (tx) => verifyChain(tx, actor.workspaceId));
    step('Verify the hash chain', before.ok, `${before.checked} rows`);
    const upd = await attempt(
      actor.workspaceId,
      sql`update audit_events set action = 'tampered.action' where workspace_id = ${actor.workspaceId}::uuid`,
    );
    step('UPDATE audit_events as app_user', upd !== null, upd ?? 'ACCEPTED (bad)');
    const del = await attempt(
      actor.workspaceId,
      sql`delete from audit_events where workspace_id = ${actor.workspaceId}::uuid`,
    );
    step('DELETE FROM audit_events as app_user', del !== null, del ?? 'ACCEPTED (bad)');
    const trunc = await attempt(actor.workspaceId, sql`truncate audit_events`);
    step('TRUNCATE audit_events as app_user', trunc !== null, trunc ?? 'ACCEPTED (bad)');
    const after = await withWorkspaceTx(actor.workspaceId, (tx) => verifyChain(tx, actor.workspaceId));
    step('Verify again: unchanged', after.ok && after.checked >= before.checked, `${after.checked} rows`);
    const ok =
      before.ok &&
      upd !== null &&
      del !== null &&
      trunc !== null &&
      after.ok &&
      after.checked >= before.checked;
    return (ok ? pass : fail)(
      `chain ok (${before.checked} rows); UPDATE: ${upd ?? 'accepted'}; DELETE: ${del ?? 'accepted'}; TRUNCATE: ${trunc ?? 'accepted'}; re-verify ok=${after.ok}`,
      [{ key: 'audit', href: '/audit' }],
    );
  },
};
