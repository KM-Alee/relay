// Metric queries (docs/03-lead-engine.md section 8, requirements Section 9). Owner: Lane D (T-150).
// ONE definition per figure, used by every screen. Repos take `tx: Tx`; the service opens the transaction.
//
// DEFENSIVE: leads / lead_events / payments / opportunities / appointments belong to Lanes A, B2 and C4 and may
// not be migrated yet. Each query runs through `guarded()`: it checks the tables exist and runs inside a
// SAVEPOINT, so a missing table or a column mismatch yields the empty fallback instead of failing the page.
// Lanes A / B2 / C4: when your migration lands, the matching function below starts returning real numbers.
// If your column names differ from docs/02-data-model.md, fix the SQL here (small, local edits only).
import type { Tx } from '@relay/db';
import { sql, type SQL } from 'drizzle-orm';
import type { Actor } from '../auth/actor';
import { contactScopeSql, leadScopeSql } from '../auth/visibility';
import { log } from '../log';

type Rows<T> = { rows: T[] };
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** `tx.execute` typed loosely: the driver result shape is `{ rows }`. */
async function rows<T>(tx: Tx, q: SQL): Promise<T[]> {
  return ((await tx.execute(q)) as unknown as Rows<T>).rows;
}

/**
 * Run `fn` only when every table exists, inside a savepoint. Any error (missing column, etc.) returns `fallback`.
 */
export async function guarded<T>(
  tx: Tx,
  tables: readonly string[],
  fallback: T,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  for (const t of tables) {
    const r = await rows<{ ok: string | null }>(tx, sql`select to_regclass(${`public.${t}`}) as ok`);
    if (!r[0]?.ok) return fallback;
  }
  try {
    return await tx.transaction((sp) => fn(sp as unknown as Tx));
  } catch (err) {
    log.warn('metrics: query unavailable, using fallback', { err: String(err), tables });
    return fallback;
  }
}

export interface DayCount {
  /** Local calendar date YYYY-MM-DD. */
  date: string;
  value: number;
}

// Local-day helpers (workspace time zone).
const dayOf = (col: string, tz: string) => sql.raw(`(${col} at time zone '${tz.replace(/'/g, '')}')::date`);
const todayLocal = (tz: string) => sql.raw(`(now() at time zone '${tz.replace(/'/g, '')}')::date`);

/** Series of the last `days` local days ending today, zero-filled. */
function fill(rowsIn: { d: string; v: unknown }[], days: number, today: string): DayCount[] {
  const map = new Map(rowsIn.map((r) => [String(r.d).slice(0, 10), num(r.v)]));
  const out: DayCount[] = [];
  const end = new Date(`${today}T00:00:00Z`).getTime();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, value: map.get(date) ?? 0 });
  }
  return out;
}

export async function localToday(tx: Tx, tz: string): Promise<string> {
  const r = await rows<{ d: string }>(tx, sql`select ${todayLocal(tz)}::text as d`);
  return r[0]?.d ?? new Date().toISOString().slice(0, 10);
}

const leadScope = (actor: Actor, col = 'l.owner_user_id') => leadScopeSql(actor, sql.raw(col));

// ── Leads ────────────────────────────────────────────────────────────────

/** "New leads today": leads.created_at within the day in the workspace tz. Last `days` days. */
export async function newLeadsPerDay(tx: Tx, actor: Actor, tz: string, days: number, today: string) {
  return guarded<DayCount[]>(tx, ['leads'], fill([], days, today), async (q) => {
    const r = await rows<{ d: string; v: string }>(
      q,
      sql`select ${dayOf('l.created_at', tz)}::text as d, count(*) as v from leads l
          where l.workspace_id = ${actor.workspaceId} and ${leadScope(actor)}
            and ${dayOf('l.created_at', tz)} > ${todayLocal(tz)} - ${days}::int
          group by 1`,
    );
    return fill(r, days, today);
  });
}

/** Average first_acknowledged_at - first_assigned_at (seconds) per local day of first acknowledgement. */
export async function firstResponsePerDay(
  tx: Tx,
  actor: Actor,
  tz: string,
  days: number,
  today: string,
): Promise<{ series: DayCount[]; samplesToday: number }> {
  const empty = { series: fill([], days, today), samplesToday: 0 };
  return guarded(tx, ['leads'], empty, async (q) => {
    const r = await rows<{ d: string; v: string | null; n: string }>(
      q,
      sql`select ${dayOf('l.first_acknowledged_at', tz)}::text as d,
                 avg(extract(epoch from (l.first_acknowledged_at - l.first_assigned_at))) as v, count(*) as n
          from leads l
          where l.workspace_id = ${actor.workspaceId} and ${leadScope(actor)}
            and l.first_acknowledged_at is not null
            and ${dayOf('l.first_acknowledged_at', tz)} > ${todayLocal(tz)} - ${days}::int
          group by 1`,
    );
    const samplesToday = num(r.find((x) => String(x.d).slice(0, 10) === today)?.n);
    return { series: fill(r, days, today), samplesToday };
  });
}

/** Recovery queue (03 section 7): R1 overdue, R2 escalated twice, R3 idle, R4 awaiting handler, R5 critical. */
export async function recoveryQueueCounts(
  tx: Tx,
  actor: Actor,
): Promise<{ count: number; critical: number }> {
  return guarded(tx, ['leads'], { count: 0, critical: 0 }, async (q) => {
    const r = await rows<{ n: string; c: string }>(
      q,
      sql`select count(*) as n, count(*) filter (where l.is_critical) as c
          from leads l left join teams t on t.id = l.team_id
          where l.workspace_id = ${actor.workspaceId} and l.status = 'open' and ${leadScope(actor)}
            and ( (l.ack_status = 'pending' and now() > l.base_window_ends_at)
               or l.escalation_count >= 2
               or coalesce(l.last_human_action_at, l.acknowledged_at, l.first_assigned_at)
                    < now() - make_interval(secs => coalesce(t.idle_seconds, 86400))
               or l.awaiting_handler
               or l.is_critical )`,
    );
    return { count: num(r[0]?.n), critical: num(r[0]?.c) };
  });
}

/** Header chips: pending leads, escalations today (ack-timeout only), pending-past-window + critical. */
export async function attentionCounts(tx: Tx, actor: Actor, tz: string) {
  const zero = { waitingAck: 0, escalatedToday: 0, needAttention: 0 };
  return guarded(tx, ['leads', 'lead_events'], zero, async (q) => {
    const a = await rows<{ w: string; n: string }>(
      q,
      sql`select count(*) filter (where l.ack_status = 'pending') as w,
                 count(*) filter (where (l.ack_status = 'pending' and now() > l.ack_window_ends_at) or l.is_critical) as n
          from leads l where l.workspace_id = ${actor.workspaceId} and l.status = 'open' and ${leadScope(actor)}`,
    );
    const e = await rows<{ n: string }>(
      q,
      sql`select count(*) as n from lead_events e join leads l on l.id = e.lead_id
          where e.workspace_id = ${actor.workspaceId} and e.type = 'escalation' and ${leadScope(actor)}
            and ${dayOf('e.occurred_at', tz)} = ${todayLocal(tz)}`,
    );
    return { waitingAck: num(a[0]?.w), escalatedToday: num(e[0]?.n), needAttention: num(a[0]?.n) };
  });
}

/** Escalations (24 h): `lead_events.type='escalation'` only; idle re-triggers are a separate figure. */
export async function escalations24h(
  tx: Tx,
  actor: Actor,
): Promise<{ count: number; idleRetriggers: number }> {
  return guarded(tx, ['leads', 'lead_events'], { count: 0, idleRetriggers: 0 }, async (q) => {
    const r = await rows<{ t: string; n: string }>(
      q,
      sql`select e.type as t, count(*) as n from lead_events e join leads l on l.id = e.lead_id
          where e.workspace_id = ${actor.workspaceId} and e.type in ('escalation','idle_retrigger')
            and e.occurred_at > now() - interval '24 hours' and ${leadScope(actor)}
          group by 1`,
    );
    return {
      count: num(r.find((x) => x.t === 'escalation')?.n),
      idleRetriggers: num(r.find((x) => x.t === 'idle_retrigger')?.n),
    };
  });
}

/** Leads / escalations per local day (chart for viewers without the value permission). */
export async function leadsAndEscalationsPerDay(
  tx: Tx,
  actor: Actor,
  tz: string,
  days: number,
  today: string,
) {
  const leads = await newLeadsPerDay(tx, actor, tz, days, today);
  const esc = await guarded<DayCount[]>(tx, ['leads', 'lead_events'], fill([], days, today), async (q) => {
    const r = await rows<{ d: string; v: string }>(
      q,
      sql`select ${dayOf('e.occurred_at', tz)}::text as d, count(*) as v from lead_events e
          join leads l on l.id = e.lead_id
          where e.workspace_id = ${actor.workspaceId} and e.type = 'escalation' and ${leadScope(actor)}
            and ${dayOf('e.occurred_at', tz)} > ${todayLocal(tz)} - ${days}::int
          group by 1`,
    );
    return fill(r, days, today);
  });
  return leads.map((d, i) => ({ date: d.date, leads: d.value, escalations: esc[i]?.value ?? 0 }));
}

/** Revenue at risk (P1 F5.7): open + pending leads, COALESCE(opportunity value, workspace default). Minor units. */
export async function revenueAtRiskMinor(tx: Tx, actor: Actor): Promise<number> {
  return guarded(tx, ['leads', 'workspaces'], 0, async (q) => {
    const r = await rows<{ v: string | null }>(
      q,
      sql`select sum(coalesce(o.value_minor, w.default_lead_value_minor, 0)) as v
          from leads l join workspaces w on w.id = l.workspace_id
          left join opportunities o on o.id = l.opportunity_id
          where l.workspace_id = ${actor.workspaceId} and l.status = 'open' and l.ack_status = 'pending'
            and ${leadScope(actor)}`,
    );
    return num(r[0]?.v);
  });
}

/** Revenue rescued (P1 F5.8): collected this month from leads with >=1 escalation before first acknowledgement. */
export async function revenueRescuedMinor(tx: Tx, actor: Actor, tz: string): Promise<number> {
  return guarded(tx, ['leads', 'lead_events', 'payments', 'payment_requests'], 0, async (q) => {
    const r = await rows<{ v: string | null }>(
      q,
      sql`select sum(case when p.kind = 'charge' then p.amount_minor else -p.amount_minor end) as v
          from payments p join payment_requests pr on pr.id = p.payment_request_id
          join leads l on l.opportunity_id = pr.opportunity_id
          where p.workspace_id = ${actor.workspaceId} and ${leadScope(actor)}
            and date_trunc('month', p.occurred_at at time zone ${tz}) = date_trunc('month', now() at time zone ${tz})
            and exists (select 1 from lead_events e where e.lead_id = l.id and e.type = 'escalation'
                          and e.occurred_at < l.first_acknowledged_at)`,
    );
    return num(r[0]?.v);
  });
}

// ── Payments (collected revenue = sum(charge) - sum(refund)) ─────────────

export async function collectedPerDay(tx: Tx, actor: Actor, tz: string, days: number, today: string) {
  const empty = { collected: fill([], days, today), count: fill([], days, today) };
  return guarded(tx, ['payments', 'payment_requests'], empty, async (q) => {
    const r = await rows<{ d: string; v: string; n: string }>(
      q,
      sql`select ${dayOf('p.occurred_at', tz)}::text as d,
                 sum(case when p.kind = 'charge' then p.amount_minor else -p.amount_minor end) as v,
                 count(*) filter (where p.kind = 'charge') as n
          from payments p join payment_requests pr on pr.id = p.payment_request_id
          where p.workspace_id = ${actor.workspaceId} and ${contactScopeSql(actor, sql.raw('pr.contact_id'))}
            and ${dayOf('p.occurred_at', tz)} > ${todayLocal(tz)} - ${days}::int
          group by 1`,
    );
    return {
      collected: fill(
        r.map((x) => ({ d: x.d, v: x.v })),
        days,
        today,
      ),
      count: fill(
        r.map((x) => ({ d: x.d, v: x.n })),
        days,
        today,
      ),
    };
  });
}

// ── Team ─────────────────────────────────────────────────────────────────

export interface TeamRow {
  userId: string;
  name: string;
  availability: 'available' | 'busy' | 'on_leave' | 'offline';
  openLeads: number;
}

/** Active users + availability (real table) with open-lead counts (defensive). Team visibility is for all. */
export async function teamAvailability(tx: Tx, workspaceId: string): Promise<TeamRow[]> {
  const users = await rows<{ id: string; name: string; availability: TeamRow['availability'] }>(
    tx,
    sql`select id, name, availability from users where workspace_id = ${workspaceId} and is_active order by name`,
  );
  const open = await guarded<Map<string, number>>(tx, ['leads'], new Map(), async (q) => {
    const r = await rows<{ u: string; n: string }>(
      q,
      sql`select owner_user_id as u, count(*) as n from leads where workspace_id = ${workspaceId}
          and status = 'open' group by 1`,
    );
    return new Map(r.map((x) => [x.u, num(x.n)]));
  });
  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    availability: u.availability,
    openLeads: open.get(u.id) ?? 0,
  }));
}

// ── Pipeline + appointments ──────────────────────────────────────────────

export interface StageRow {
  stageId: string;
  name: string;
  count: number;
  valueMinor: number;
}

/** Open pipeline value by stage (default pipeline first). Raw minor sums: the SERVICE masks them. */
export async function pipelineByStage(tx: Tx, actor: Actor): Promise<StageRow[]> {
  return guarded<StageRow[]>(tx, ['stages', 'opportunities'], [], async (q) => {
    const r = await rows<{ id: string; name: string; n: string; v: string | null }>(
      q,
      sql`select s.id, s.name, count(o.id) as n, coalesce(sum(o.value_minor), 0) as v
          from stages s join pipelines p on p.id = s.pipeline_id
          left join opportunities o on o.stage_id = s.id and o.deleted_at is null and o.closed_at is null
            and ${contactScopeSql(actor, sql.raw('o.contact_id'))}
          where s.workspace_id = ${actor.workspaceId} and s.kind = 'open' and p.is_default
          group by s.id, s.name, s.position order by s.position`,
    );
    return r.map((x) => ({ stageId: x.id, name: x.name, count: num(x.n), valueMinor: num(x.v) }));
  });
}

export interface AppointmentRow {
  id: string;
  startsAt: Date;
  title: string;
  contactName: string;
  ownerName: string;
}

export async function upcomingAppointments(
  tx: Tx,
  actor: Actor,
  limit = 5,
): Promise<{ total: number; items: AppointmentRow[] }> {
  return guarded(tx, ['appointments', 'contacts'], { total: 0, items: [] as AppointmentRow[] }, async (q) => {
    const where = sql`a.workspace_id = ${actor.workspaceId} and a.status = 'scheduled' and a.starts_at >= now()
      and ${contactScopeSql(actor, sql.raw('a.contact_id'))}`;
    const t = await rows<{ n: string }>(q, sql`select count(*) as n from appointments a where ${where}`);
    const r = await rows<{ id: string; starts_at: Date | string; title: string; cn: string; un: string }>(
      q,
      sql`select a.id, a.starts_at, a.title, c.name as cn, u.name as un from appointments a
          join contacts c on c.id = a.contact_id join users u on u.id = a.user_id
          where ${where} order by a.starts_at limit ${limit}`,
    );
    return {
      total: num(t[0]?.n),
      items: r.map((x) => ({
        id: x.id,
        startsAt: new Date(x.starts_at),
        title: x.title,
        contactName: x.cn,
        ownerName: x.un,
      })),
    };
  });
}

// ── Lead Radar ───────────────────────────────────────────────────────────

export interface RadarLeadRow {
  id: string;
  contactName: string;
  sourceLabel: string;
  ownerUserId: string;
  ownerName: string;
  custody: 'handler' | 'fallback';
  awaitingHandler: boolean;
  awaitingReason: string | null;
  ackWindowEndsAt: Date | null;
  windowMs: number;
  escalationLevel: number;
  isUrgent: boolean;
  isCritical: boolean;
}

/** Open leads still waiting for a human acknowledgement (or in fallback custody), in the actor's scope. */
export async function radarLeads(tx: Tx, actor: Actor): Promise<RadarLeadRow[]> {
  return guarded<RadarLeadRow[]>(tx, ['leads', 'contacts'], [], async (q) => {
    const r = await rows<{
      id: string;
      cn: string;
      src: string | null;
      ou: string;
      on: string;
      custody: 'handler' | 'fallback';
      ah: boolean;
      ar: string | null;
      ends: Date | string | null;
      win: string | null;
      lvl: number;
      urg: boolean;
      crit: boolean;
    }>(
      q,
      sql`select l.id, c.name as cn, l.source_label as src, l.owner_user_id as ou, u.name as "on", l.custody,
                 l.awaiting_handler as ah, l.awaiting_reason as ar, l.ack_window_ends_at as ends,
                 extract(epoch from (l.ack_window_ends_at - l.assigned_at)) * 1000 as win,
                 l.escalation_level as lvl, l.is_urgent as urg, l.is_critical as crit
          from leads l join contacts c on c.id = l.contact_id join users u on u.id = l.owner_user_id
          where l.workspace_id = ${actor.workspaceId} and l.status = 'open'
            and (l.ack_status = 'pending' or l.awaiting_handler) and ${leadScope(actor)}
          order by l.ack_window_ends_at nulls last limit 60`,
    );
    return r.map((x) => ({
      id: x.id,
      contactName: x.cn,
      sourceLabel: x.src ?? '',
      ownerUserId: x.ou,
      ownerName: x.on,
      custody: x.custody,
      awaitingHandler: x.ah,
      awaitingReason: x.ar,
      ackWindowEndsAt: x.ends ? new Date(x.ends) : null,
      windowMs: x.win && Number(x.win) > 0 ? Math.round(Number(x.win)) : 300_000,
      escalationLevel: num(x.lvl),
      isUrgent: x.urg,
      isCritical: x.crit,
    }));
  });
}

export async function dbNow(tx: Tx): Promise<Date> {
  const r = await rows<{ n: Date | string }>(tx, sql`select now() as n`);
  return new Date(r[0]?.n ?? Date.now());
}

export async function workspaceCurrency(
  tx: Tx,
  workspaceId: string,
): Promise<{ currency: string; timezone: string }> {
  const r = await rows<{ currency: string; timezone: string }>(
    tx,
    sql`select currency, timezone from workspaces where id = ${workspaceId}`,
  );
  return { currency: r[0]?.currency ?? 'PKR', timezone: r[0]?.timezone ?? 'Asia/Karachi' };
}
