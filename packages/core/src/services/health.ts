// Health check (T-004, Q18): DB ping + build metadata. No secrets, no data. Used by GET /api/health.
import { withSystemTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { log } from '../log';

export interface HealthReport {
  ok: boolean;
  db: 'ok' | 'down';
  /** Short git sha of the deployment (VERCEL_GIT_COMMIT_SHA), or 'dev'. */
  version: string;
  time: string;
}

export interface HealthDeps {
  /** Resolves when the database answers; rejects otherwise. */
  ping: () => Promise<void>;
  env: Record<string, string | undefined>;
  now: () => Date;
  timeoutMs: number;
}

const defaultDeps: HealthDeps = {
  ping: () => withSystemTx((tx) => tx.execute(sql`select 1`)).then(() => undefined),
  env: process.env,
  now: () => new Date(),
  timeoutMs: 4000,
};

export async function checkHealth(deps: Partial<HealthDeps> = {}): Promise<HealthReport> {
  const d = { ...defaultDeps, ...deps };
  let db: HealthReport['db'] = 'ok';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      d.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('db ping timed out')), d.timeoutMs);
      }),
    ]);
  } catch (err) {
    db = 'down';
    // The error text may contain connection details: the redacting logger reduces it to name+message.
    log.error('health.db_down', { err });
  } finally {
    clearTimeout(timer);
  }
  const sha = d.env.VERCEL_GIT_COMMIT_SHA;
  return {
    ok: db === 'ok',
    db,
    version: sha ? sha.slice(0, 7) : 'dev',
    time: d.now().toISOString(),
  };
}
