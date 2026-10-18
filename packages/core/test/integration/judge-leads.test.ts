// [F3.4] [F3.6] [F3.8] Judge Console lead scenarios run against real Postgres (T-160).
import { randomUUID } from 'node:crypto';
import { closeDb, withWorkspaceTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../../src/auth/actor';
import { LEVEL_DEFAULTS } from '../../src/auth/permissions';
import { provisionTeams } from '../../src/auth/provisioning-teams';
import * as teamsRepo from '../../src/repos/teams';
import { leadAbsenceReassign } from '../../src/services/judge/scenarios/lead-absence-reassign';
import { leadFallbackCustody } from '../../src/services/judge/scenarios/lead-fallback-custody';
import { leadTimersOnce } from '../../src/services/judge/scenarios/lead-timers-once';
import type { JudgeScenario } from '../../src/services/judge/types';

interface Fixture {
  ws: string;
  ownerId: string;
  a: string;
  b: string;
  slug: string;
}

async function fixture(): Promise<Fixture> {
  const ws = randomUUID();
  const [ownerId, a, b] = [randomUUID(), randomUUID(), randomUUID()];
  const slug = `t-${ws.slice(0, 8)}`;
  await withWorkspaceTx(ws, async (tx) => {
    await tx.execute(sql`insert into workspaces (id, name, slug) values (${ws}, 'Leads test', ${slug})`);
    const user = (id: string, name: string, level: string, availability: string) =>
      tx.execute(sql`insert into users (id, workspace_id, email, name, password_hash, base_level, availability)
        values (${id}, ${ws}, ${`${id}@leads.test`}, ${name}, 'x', ${level}::user_base_level, ${availability}::user_availability)`);
    await user(ownerId, 'Owner', 'owner', 'offline');
    await user(a, 'Ali', 'user', 'available');
    await user(b, 'Sara', 'user', 'available');
    await tx.execute(sql`update workspaces set owner_user_id = ${ownerId} where id = ${ws}`);
    const { teamId } = await provisionTeams(tx, { workspaceId: ws, ownerUserId: ownerId, locale: 'en' });
    await teamsRepo.addMember(tx, { workspaceId: ws, teamId, userId: a });
    await teamsRepo.addMember(tx, { workspaceId: ws, teamId, userId: b });
  });
  return { ws, ownerId, a, b, slug };
}

afterAll(async () => {
  await closeDb();
});

describe('Judge lead scenarios', () => {
  const cases: [string, JudgeScenario][] = [
    ['[F3.4] fallback custody', leadFallbackCustody],
    ['[F3.8] timers fire once', leadTimersOnce],
    ['[F3.6] absence reassign', leadAbsenceReassign],
  ];
  for (const [title, sc] of cases) {
    it(title, async () => {
      const f = await fixture();
      const actor: Actor = {
        userId: f.ownerId,
        workspaceId: f.ws,
        sessionId: randomUUID(),
        baseLevel: 'owner',
        permissions: new Set(LEVEL_DEFAULTS.owner),
        locale: 'en',
      };
      const r = await sc.run({ actor, origin: 'http://localhost', step: () => undefined });
      expect(r.actual).toBeTruthy();
      expect(r.status, r.actual).toBe('pass');
      const av = await withWorkspaceTx(
        f.ws,
        async (tx) =>
          (
            await tx.execute<{ availability: string }>(
              sql`select availability::text availability from users where id = ${f.ownerId}`,
            )
          ).rows[0]?.availability,
      );
      expect(av).toBe('offline'); // restored
    });
  }
});
