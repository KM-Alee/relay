// realtime_events data access (T-009). Repos take `tx: Tx`; services open the transaction.
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';

export interface RealtimeEventRow {
  id: string;
  topic: string;
  ids: string[];
  at: Date;
}

export async function insertEvent(
  tx: Tx,
  e: { workspaceId: string; userId: string | null; topic: string; ids: string[] },
): Promise<void> {
  await tx.execute(sql`
    insert into realtime_events (workspace_id, user_id, topic, ids)
    values (${e.workspaceId}, ${e.userId}, ${e.topic}, ${toUuidArray(e.ids)})
  `);
}

/** `ARRAY[...]::uuid[]` from validated uuids (callers validate; this stays parameterised). */
function toUuidArray(ids: string[]) {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`array[${sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  )}]::uuid[]`;
}

/** The DB clock (one source of time for every client cursor). */
export async function dbNow(tx: Tx): Promise<Date> {
  const res = await tx.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`);
  return new Date(res.rows[0]!.now);
}

/** Is `since` older than the retention window (so hints may have been pruned)? */
export async function isOlderThan(tx: Tx, since: Date, seconds: number): Promise<boolean> {
  const res = await tx.execute<{ stale: boolean }>(
    sql`select ${since.toISOString()}::timestamptz < clock_timestamp() - make_interval(secs => ${seconds}) as stale`,
  );
  return Boolean(res.rows[0]?.stale);
}

/**
 * Hints after `since` for a workspace, restricted to `topics`, and to the workspace-wide events plus the
 * ones addressed to `userId`. Oldest first. RLS also scopes by workspace; the explicit filter keeps the
 * index in play and documents intent.
 */
export async function listSince(
  tx: Tx,
  q: { workspaceId: string; userId: string; since: Date; topics: readonly string[]; limit: number },
): Promise<RealtimeEventRow[]> {
  if (q.topics.length === 0) return [];
  const res = await tx.execute<{ id: string; topic: string; ids: string[]; at: Date | string }>(sql`
    select id, topic, ids, occurred_at as at
    from realtime_events
    where workspace_id = ${q.workspaceId}
      and occurred_at > ${q.since.toISOString()}::timestamptz
      and topic = any(${sql`array[${sql.join(
        q.topics.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]`})
      and (user_id is null or user_id = ${q.userId})
    order by occurred_at, id
    limit ${q.limit}
  `);
  return res.rows.map((r) => ({ id: r.id, topic: r.topic, ids: r.ids, at: new Date(r.at) }));
}

/** Delete hints older than `seconds` in ALL workspaces (SECURITY DEFINER; tick has no workspace context). */
export async function prune(tx: Tx, seconds: number): Promise<number> {
  const res = await tx.execute<{ n: string | number }>(sql`select realtime_prune_events(${seconds}) as n`);
  return Number(res.rows[0]?.n ?? 0);
}
