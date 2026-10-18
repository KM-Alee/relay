import { describe, expect, it } from 'vitest';
import { checkHealth, type DbIdentity } from './health';

const now = () => new Date('2026-10-18T10:00:00.000Z');
const appUser: DbIdentity = { user: 'app_user', bypassRls: false, superuser: false };
const owner: DbIdentity = { user: 'neondb_owner', bypassRls: true, superuser: false };

describe('[Q18] health report', () => {
  it('[Q18] reports ok with the short git sha when the DB answers', async () => {
    const r = await checkHealth({
      ping: async () => appUser,
      env: { VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890', VERCEL_ENV: 'production' },
      now,
    });
    expect(r).toEqual({ ok: true, db: 'ok', version: 'abcdef1', time: '2026-10-18T10:00:00.000Z' });
  });

  it('[Q18] reports db down (ok=false) when the ping rejects, without leaking the error text', async () => {
    const r = await checkHealth({
      ping: async () => {
        throw new Error('connect ECONNREFUSED postgres://user:hunter2@host/db');
      },
      env: {},
      now,
    });
    expect(r).toMatchObject({ ok: false, db: 'down', version: 'dev' });
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });

  it('[Q18] a hanging DB times out as down', async () => {
    const r = await checkHealth({ ping: () => new Promise(() => {}), env: {}, now, timeoutMs: 20 });
    expect(r.db).toBe('down');
  });

  it('[Q6][Q18] in production/preview, connecting as the owner (BYPASSRLS) is wrong_role and not ok', async () => {
    for (const VERCEL_ENV of ['production', 'preview']) {
      const r = await checkHealth({ ping: async () => owner, env: { VERCEL_ENV }, now });
      expect(r).toMatchObject({ ok: false, db: 'wrong_role' });
    }
  });

  it('[Q6][Q18] a superuser app_user lookalike is rejected; the role is not enforced outside deployments', async () => {
    expect(
      (
        await checkHealth({
          ping: async () => ({ ...appUser, superuser: true }),
          env: { VERCEL_ENV: 'production' },
          now,
        })
      ).db,
    ).toBe('wrong_role');
    expect((await checkHealth({ ping: async () => owner, env: {}, now })).db).toBe('ok');
  });
});
