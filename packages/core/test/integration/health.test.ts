// [Q18] health against real Postgres as app_user.
import { closeDb } from '@relay/db';
import { afterAll, expect, it } from 'vitest';
import { checkHealth } from '../../src/services/health';

afterAll(async () => {
  await closeDb();
});

it('[Q18] health check pings the real database via withSystemTx', async () => {
  const r = await checkHealth();
  expect(r).toMatchObject({ ok: true, db: 'ok' });
});
