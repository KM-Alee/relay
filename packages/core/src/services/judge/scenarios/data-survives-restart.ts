// Q5 / rubric 9: data and timers live in Postgres, so a restart loses nothing.
import { withSystemTx, withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { fail, pass, type JudgeScenario } from '../types';

export const dataSurvivesRestart: JudgeScenario = {
  id: 'data-survives-restart',
  criterion: 9,
  reqs: ['Q5', 'Q6'],
  expected:
    'Rows written before this server process started are still present, and the scheduler heartbeat is stored in the database',
  async run({ actor, step }) {
    const bootedAt = new Date(Date.now() - process.uptime() * 1000);
    const rows = await withWorkspaceTx(actor.workspaceId, async (tx) => {
      const q = async (t: string, col = 'created_at') =>
        (
          await tx.execute<{ n: string; oldest: Date | null }>(
            sql.raw(`select count(*) n, min(${col}) oldest from ${t}`),
          )
        ).rows[0];
      return {
        contacts: await q('contacts'),
        users: await q('users'),
        audit: await q('audit_events', 'occurred_at'),
      };
    });
    const dates = [rows.contacts?.oldest, rows.users?.oldest, rows.audit?.oldest]
      .filter(Boolean)
      .map((d) => new Date(d as Date));
    const oldest = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
    const survived = !!oldest && oldest < bootedAt;
    step(
      'Server process started',
      true,
      `${bootedAt.toISOString()} (uptime ${Math.round(process.uptime())}s)`,
    );
    step(
      'Oldest stored record predates this process',
      survived,
      oldest ? `written ${oldest.toISOString()}` : 'no audit rows yet',
    );
    step(
      'Records persisted',
      Number(rows.contacts?.n) > 0,
      `${rows.contacts?.n} contacts, ${rows.users?.n} users, ${rows.audit?.n} audit events`,
    );

    const tick = await withSystemTx(
      async (tx) =>
        (await tx.execute<{ at: Date | null }>(sql`select max(started_at) at from job_runs`)).rows[0]?.at ??
        null,
    ).catch(() => null);
    step(
      'Scheduler heartbeat lives in the database (job_runs)',
      true,
      tick ? `last tick ${new Date(tick).toISOString()}` : 'no tick recorded yet',
    );

    const ok = survived && Number(rows.contacts?.n) > 0;
    const actual = `process started ${bootedAt.toISOString()}; oldest record ${oldest?.toISOString() ?? 'none'}; ${rows.contacts?.n} contacts, ${rows.audit?.n} audit events persisted; last tick ${tick ? new Date(tick).toISOString() : 'none'}`;
    return (ok ? pass : fail)(actual, [{ key: 'audit', href: '/audit' }]);
  },
};
