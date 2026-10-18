// [F10.4][Q13] Seed framework: idempotent, and produces login-able accounts per level (T-010).
import { closeDb, createDb } from '@relay/db';
import { DEV_PASSWORD, runSeeds, SEED_USERS } from '@relay/db/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDbUrls } from '../../../db/test/db-urls';
import { authService } from '../../src/services/auth';
import { devLoginService } from '../../src/services/dev-login';

beforeAll(async () => {
  const { db, pool } = createDb({ connectionString: testDbUrls().ownerUrl, max: 1 });
  try {
    await runSeeds({ db, log: () => undefined });
    await runSeeds({ db, log: () => undefined }); // idempotent: second run is a no-op
    // Repeated local runs share the test DB: clear login rate-limit windows so this test isn't flaky.
    await pool.query(`delete from rate_limits where key like 'login:%'`);
  } finally {
    await pool.end();
  }
});
afterAll(async () => {
  await closeDb();
});

describe('[F10.4] seed', () => {
  it('[Q13] every seed account logs in with the dev password and gets its level', async () => {
    for (const [i, u] of SEED_USERS.entries()) {
      const r = await authService.login(
        { email: u.email, password: DEV_PASSWORD },
        { ip: `10.77.0.${i + 1}` },
      );
      expect(r.me.user).toMatchObject({ id: u.id, baseLevel: u.baseLevel });
    }
  });

  it('[F1.7] the seeded Manager gets view-all + value view on top of User; the plain User does not', async () => {
    const users = await devLoginService.listSeedUsers();
    expect(users.map((u) => u.email)).toEqual(SEED_USERS.map((u) => u.email));
    const manager = await devLoginService.loginAs(
      SEED_USERS.find((u) => u.email === 'manager@sunrise.test')!.id,
    );
    expect(manager.me.permissions).toEqual(
      expect.arrayContaining(['leads.view_all', 'crm.opportunity.value.view']),
    );
    const user = await devLoginService.loginAs(SEED_USERS.find((u) => u.email === 'user@sunrise.test')!.id);
    expect(user.me.permissions).not.toContain('leads.view_all');
    await expect(devLoginService.loginAs('0192f3a0-0000-7000-8000-00000000ffff')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
