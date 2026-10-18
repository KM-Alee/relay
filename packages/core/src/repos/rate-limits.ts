// rate_limits data access. Repos take `tx: Tx`; services open the transaction.
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';

export interface WindowHit {
  count: number;
  windowStart: Date;
  /** Seconds until this window ends (≥ 1). */
  retryAfterSeconds: number;
}

/**
 * Atomically count one hit in the current fixed window. Postgres owns time: windows are aligned to
 * the epoch in multiples of `windowSeconds` using the DB clock, so every instance agrees.
 */
export async function hit(tx: Tx, key: string, windowSeconds: number): Promise<WindowHit> {
  const res = await tx.execute<{
    count: number;
    window_start: Date | string;
    retry_after: string | number;
  }>(sql`
    insert into rate_limits as rl (key, window_start, count)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1)
    on conflict (key, window_start) do update set count = rl.count + 1
    returning rl.count,
              rl.window_start,
              ceil(extract(epoch from (rl.window_start + make_interval(secs => ${windowSeconds}) - now()))) as retry_after
  `);
  const row = res.rows[0];
  if (!row) throw new Error('rate_limits upsert returned no row');
  return {
    count: Number(row.count),
    windowStart: new Date(row.window_start),
    retryAfterSeconds: Math.max(1, Number(row.retry_after)),
  };
}

/** Delete windows that ended before `olderThanSeconds` ago (daily outbox job). */
export async function prune(tx: Tx, olderThanSeconds = 86_400): Promise<number> {
  const res = await tx.execute(
    sql`delete from rate_limits where window_start < now() - make_interval(secs => ${olderThanSeconds})`,
  );
  return res.rowCount ?? 0;
}
