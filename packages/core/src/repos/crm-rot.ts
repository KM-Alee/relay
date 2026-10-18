// Stage rot query (T-221, F2.9). ONE definition of "rotting": an OPEN opportunity whose stage has a rot period
// and whose last recorded action (the later of entering the stage and the last activity) is older than it.
// Time-warp (F10.2) scales durations: idle real seconds are multiplied by the workspace multiplier so a
// 7-day rot period rots in minutes in the demo. Postgres owns time: `now()` here, never a JS clock.
//
// Recovery integration (Lane A2): `rottingRows(tx, ...)` is the "R6 rotting deal" source; call it from the
// recovery queue query/service with the same `scope` fragment the queue already applies.
import type { Tx } from '@relay/db';
import { sql, type SQL } from 'drizzle-orm';

export interface RottingRow {
  [key: string]: unknown;
  id: string;
  contact_id: string;
  contact_name: string;
  pipeline_id: string;
  stage_id: string;
  stage_name: string;
  title: string;
  value_minor: string | number | null;
  currency: string;
  owner_user_id: string | null;
  owner_name: string | null;
  stage_entered_at: Date;
  closed_at: Date | null;
  version: number;
  created_at: Date;
  rot_seconds: number;
  idle_seconds: string | number;
}

export interface RottingFilter {
  workspaceId: string;
  /** Record-visibility fragment on alias `o` (see `scopeSql(actor, 'opportunity')`). */
  scope: SQL;
  pipelineId?: string;
  /** Restrict to these opportunity ids (the board asks about the cards it is showing). */
  ids?: readonly string[];
  limit?: number;
}

export async function rottingRows(tx: Tx, f: RottingFilter): Promise<RottingRow[]> {
  const ids = f.ids?.length
    ? sql`and o.id in (${sql.join(
        f.ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )})`
    : f.ids
      ? sql`and false`
      : sql``;
  const res = await tx.execute(
    sql`select o.*, c.name as contact_name, u.name as owner_name, s.name as stage_name, s.rot_seconds,
               floor(extract(epoch from (now() - greatest(o.stage_entered_at, coalesce(o.last_activity_at, o.stage_entered_at))))
                     * w.time_warp_multiplier)::bigint as idle_seconds
        from opportunities o
        join stages s on s.workspace_id = o.workspace_id and s.id = o.stage_id
        join contacts c on c.workspace_id = o.workspace_id and c.id = o.contact_id
        join workspaces w on w.id = o.workspace_id
        left join users u on u.workspace_id = o.workspace_id and u.id = o.owner_user_id
        where o.workspace_id = ${f.workspaceId}::uuid and o.deleted_at is null and c.deleted_at is null
          and o.closed_at is null and s.kind = 'open' and s.rot_seconds is not null
          and extract(epoch from (now() - greatest(o.stage_entered_at, coalesce(o.last_activity_at, o.stage_entered_at))))
              * w.time_warp_multiplier > s.rot_seconds
          ${f.pipelineId ? sql`and o.pipeline_id = ${f.pipelineId}::uuid` : sql``}
          ${ids}
          and ${f.scope}
        order by idle_seconds desc, o.id
        limit ${f.limit ?? 200}`,
  );
  return res.rows as unknown as RottingRow[];
}
