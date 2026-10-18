// Health check (T-004, Q18): DB ping + role assertion + build metadata. No secrets, no data.
// Used by GET /api/health.
import { withSystemTx } from '@relay/db';
import { sql } from 'drizzle-orm';
import { log } from '../log';

export interface HealthReport {
  ok: boolean;
  /** `wrong_role`: connected, but not as app_user / with BYPASSRLS (06 §3): refuse to call it healthy. */
  db: 'ok' | 'down' | 'wrong_role';
  /** Short git sha of the deployment (VERCEL_GIT_COMMIT_SHA), or 'dev'. */
  version: string;
  time: string;
}

export interface DbIdentity {
  user: string;
  bypassRls: boolean;
  superuser: boolean;
}

export interface HealthDeps {
  /** Resolves with the connected role when the database answers; rejects otherwise. */
  ping: () => Promise<DbIdentity>;
  env: Record<string, string | undefined>;
  now: () => Date;
  timeoutMs: number;
}

const defaultDeps: HealthDeps = {
  ping: () =>
    withSystemTx(async (tx) => {
      const res = await tx.execute<{ u: string; bypass: boolean; su: boolean }>(
        sql`select current_user as u, r.rolbypassrls as bypass, r.rolsuper as su
            from pg_roles r where r.rolname = current_user`,
      );
      const row = res.rows[0];
      if (!row) throw new Error('pg_roles returned no row for current_user');
      return { user: row.u, bypassRls: row.bypass, superuser: row.su };
    }),
  env: process.env,
  now: () => new Date(),
  timeoutMs: 4000,
};

/** Deployed (Vercel production/preview) runtime must be app_user without BYPASSRLS (06 §3). */
export function roleIsAcceptable(id: DbIdentity): boolean {
  return id.user === 'app_user' && !id.bypassRls && !id.superuser;
}

export async function checkHealth(deps: Partial<HealthDeps> = {}): Promise<HealthReport> {
  const d = { ...defaultDeps, ...deps };
  let db: HealthReport['db'] = 'ok';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = await Promise.race([
      d.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('db ping timed out')), d.timeoutMs);
      }),
    ]);
    const deployed = ['production', 'preview'].includes(d.env.VERCEL_ENV ?? '');
    if (deployed && !roleIsAcceptable(id)) {
      db = 'wrong_role';
      log.error('health.wrong_db_role', { role: id.user, bypassRls: id.bypassRls, superuser: id.superuser });
    }
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
