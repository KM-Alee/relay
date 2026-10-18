import { describe, expect, it } from 'vitest';
import { checkHealth } from './health';

const now = () => new Date('2026-10-18T10:00:00.000Z');

describe('[Q18] health report', () => {
  it('[Q18] reports ok with the short git sha when the DB answers', async () => {
    const r = await checkHealth({
      ping: async () => {},
      env: { VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890' },
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
});
