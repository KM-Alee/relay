// F1.6 / rubric 1: another workspace's record is a 404 through the service and invisible to SQL as this tenant.
import { withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { contactsService } from '../../crm-records';
import { expectError, uuidFrom } from '../helpers';
import { fail, pass, type JudgeScenario } from '../types';

const count = async (ws: string, id: string): Promise<number> =>
  withWorkspaceTx(ws, async (tx) =>
    Number(
      (await tx.execute<{ n: string }>(sql`select count(*) n from contacts where id = ${id}::uuid`)).rows[0]
        ?.n,
    ),
  );

export const crossWorkspace: JudgeScenario = {
  id: 'cross-workspace',
  criterion: 1,
  reqs: ['F1.6', 'Q2'],
  expected:
    'GET of another workspace record id: 404 through the service; 0 rows through raw SQL as this tenant',
  async run({ actor, step }) {
    // One reusable throwaway tenant per judge workspace (workspaces are never deleted at runtime).
    const foreignWs = uuidFrom(`judge-foreign-ws:${actor.workspaceId}`);
    const foreignContact = uuidFrom(`judge-foreign-contact:${actor.workspaceId}`);
    await withWorkspaceTx(foreignWs, async (tx) => {
      await tx.execute(sql`insert into workspaces (id, name, slug) values (${foreignWs}::uuid,
        'Judge foreign tenant', ${'judge-foreign-' + foreignWs.slice(0, 8)}) on conflict (id) do nothing`);
      await tx.execute(sql`insert into contacts (id, workspace_id, name) values (${foreignContact}::uuid,
        ${foreignWs}::uuid, '[judge] foreign workspace record') on conflict (id) do nothing`);
    });
    const own = await count(foreignWs, foreignContact);
    step(
      'Created a record in a second (throwaway) workspace',
      own === 1,
      `visible to its own tenant: ${own} row`,
    );

    const err = await expectError(() => contactsService.get(actor, foreignContact));
    step('Service read of that id as the judge', err.status === 404, `HTTP ${err.status} ${err.code}`);

    const raw = await count(actor.workspaceId, foreignContact);
    step('Raw SQL as app_user with this tenant context (RLS)', raw === 0, `${raw} rows`);

    return own === 1 && err.status === 404 && raw === 0
      ? pass(
          `service: 404 ${err.code}; raw SQL under RLS: ${raw} rows; the record exists in its own tenant (${own})`,
        )
      : fail(`service: HTTP ${err.status} ${err.code}; raw rows: ${raw}; own-tenant rows: ${own}`);
  },
};
