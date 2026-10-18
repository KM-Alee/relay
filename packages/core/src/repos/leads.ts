// Leads repo (docs/02-data-model.md §4). Owner: Lane A. Takes `tx`; called only from services/jobs.
// Writes: insert (intake) and the VERSIONED update (every other transition, 03 §5).
import type { Tx } from '@relay/db';
import { leadEvents, leads, notifications, type LeadEventRow, type LeadRow } from '@relay/db/schema';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { LeadEventIntent, LeadSnapshot, NotificationIntent } from '../domain/leads';
import { uuidv7 } from '../ids';

export type { LeadEventRow, LeadRow };

/** Non-engine lead columns written at intake. */
export interface LeadIntakeExtras {
  contactId: string | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  message: string | null;
  sourceKind: 'web_form' | 'whatsapp' | 'manual';
  sourceId: string | null;
  sourceLabel: string;
  urgentSource: 'manual' | 'ai' | null;
}

export function toSnapshot(r: LeadRow): LeadSnapshot {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    teamId: r.teamId,
    status: r.status,
    closedReason: r.closedReason as LeadSnapshot['closedReason'],
    ownerUserId: r.ownerUserId,
    custody: r.custody,
    awaitingHandler: r.awaitingHandler,
    awaitingReason: r.awaitingReason as LeadSnapshot['awaitingReason'],
    ackStatus: r.ackStatus,
    acknowledgedAt: r.acknowledgedAt,
    acknowledgedVia: r.acknowledgedVia as LeadSnapshot['acknowledgedVia'],
    firstAssignedAt: r.firstAssignedAt,
    assignedAt: r.assignedAt,
    firstAcknowledgedAt: r.firstAcknowledgedAt,
    lastHumanActionAt: r.lastHumanActionAt,
    isUrgent: r.isUrgent,
    isCritical: r.isCritical,
    escalationLevel: r.escalationLevel,
    escalationCycle: r.escalationCycle,
    escalationCount: r.escalationCount,
    idleRetriggerCount: r.idleRetriggerCount,
    overdueAttemptCount: r.overdueAttemptCount,
    ackWindowEndsAt: r.ackWindowEndsAt,
    escalateAt: r.escalateAt,
    routingRetryAt: r.routingRetryAt,
    idleCheckAt: r.idleCheckAt,
    baseWindowEndsAt: r.baseWindowEndsAt,
    version: r.version,
  };
}

/** Row lock for a transition (03 §5). RLS limits it to the tx's workspace. */
export async function lockLead(tx: Tx, id: string): Promise<LeadRow | null> {
  const rows = await tx.select().from(leads).where(eq(leads.id, id)).for('update');
  return rows[0] ?? null;
}

export async function getLead(tx: Tx, id: string, scope: SQL = sql`true`): Promise<LeadRow | null> {
  const rows = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), scope));
  return rows[0] ?? null;
}

export async function insertLead(tx: Tx, s: LeadSnapshot, x: LeadIntakeExtras): Promise<void> {
  await tx.insert(leads).values({ ...s, ...x });
}

/** Conditional update: must hit exactly one row, else the caller lost a race (STALE_VERSION). */
export async function updateLeadVersioned(
  tx: Tx,
  id: string,
  expectedVersion: number,
  patch: Partial<LeadSnapshot>,
): Promise<boolean> {
  const { id: _id, workspaceId: _ws, version: _v, ...set } = patch;
  const res = await tx
    .update(leads)
    .set({ ...set, version: sql`${leads.version} + 1` })
    .where(and(eq(leads.id, id), eq(leads.version, expectedVersion)))
    .returning({ id: leads.id });
  return res.length === 1;
}

export async function insertEvents(
  tx: Tx,
  workspaceId: string,
  leadId: string,
  events: readonly LeadEventIntent[],
): Promise<void> {
  if (!events.length) return;
  const base = Date.now(); // ids sort in emission order within one transition (timeline order)
  await tx.insert(leadEvents).values(
    events.map((e, i) => ({
      id: uuidv7(base + i),
      workspaceId,
      leadId,
      type: e.type,
      fromUserId: e.fromUserId,
      toUserId: e.toUserId,
      custody: e.custody,
      escalationLevel: e.escalationLevel,
      trace: e.trace,
      meta: e.meta ?? null,
      actorType: e.actorType,
      actorUserId: e.actorUserId,
      occurredAt: e.occurredAt,
    })),
  );
}

export async function insertNotifications(
  tx: Tx,
  workspaceId: string,
  items: readonly NotificationIntent[],
): Promise<void> {
  if (!items.length) return;
  await tx.insert(notifications).values(
    items.map((n) => ({
      id: uuidv7(),
      workspaceId,
      userId: n.userId,
      type: n.type,
      leadId: n.leadId,
      params: n.params,
    })),
  );
}

export async function listEvents(tx: Tx, leadId: string): Promise<LeadEventRow[]> {
  return tx
    .select()
    .from(leadEvents)
    .where(eq(leadEvents.leadId, leadId))
    .orderBy(asc(leadEvents.occurredAt), asc(leadEvents.id));
}

const HOLDING_EVENTS = [
  'intake_assigned',
  'routing_retry_assigned',
  'escalation',
  'absence_reassign',
  'deactivation_reassign',
  'manual_reassign',
  'idle_retrigger',
];

/** Handlers who held the lead since the current escalation cycle began (03 §4 `already_tried`). */
export async function triedThisCycle(tx: Tx, leadId: string): Promise<string[]> {
  const res = await tx.execute<{ uid: string }>(sql`
    select distinct e.to_user_id as uid from lead_events e
     where e.lead_id = ${leadId} and e.custody = 'handler' and e.to_user_id is not null
       and e.type = any(${`{${HOLDING_EVENTS.join(',')}}`}::text[])
       and e.occurred_at >= coalesce((select max(o.occurred_at) from lead_events o
                                       where o.lead_id = ${leadId} and o.type in ('overdue_attempt', 'idle_retrigger')),
                                      '-infinity'::timestamptz)`);
  return res.rows.map((r) => r.uid);
}

/** An open lead for the same contact (03 T1 step 1): by contact id, phone or email. */
export async function findOpenForContact(
  tx: Tx,
  c: { contactId: string | null; phone: string | null; email: string | null },
): Promise<LeadRow | null> {
  const ors: SQL[] = [];
  if (c.contactId) ors.push(eq(leads.contactId, c.contactId));
  if (c.phone) ors.push(eq(leads.contactPhone, c.phone));
  if (c.email) ors.push(sql`${leads.contactEmail} = ${c.email}::citext`);
  if (!ors.length) return null;
  const rows = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.status, 'open'), or(...ors)))
    .orderBy(asc(leads.createdAt))
    .limit(1)
    .for('update');
  return rows[0] ?? null;
}

export async function listLeads(
  tx: Tx,
  o: { scope: SQL; status?: 'open' | 'closed'; ownerUserId?: string; limit: number; before?: string },
): Promise<LeadRow[]> {
  const where: SQL[] = [o.scope];
  if (o.status) where.push(eq(leads.status, o.status));
  if (o.ownerUserId) where.push(eq(leads.ownerUserId, o.ownerUserId));
  if (o.before) where.push(lt(leads.id, o.before));
  return tx
    .select()
    .from(leads)
    .where(and(...where))
    .orderBy(desc(leads.id))
    .limit(o.limit);
}

/** Pending handler leads owned by a user (T5 absence). */
export async function pendingHandlerLeadIds(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.ownerUserId, userId),
        eq(leads.status, 'open'),
        eq(leads.custody, 'handler'),
        eq(leads.ackStatus, 'pending'),
      ),
    );
  return rows.map((r) => r.id);
}

export async function awaitingLeadIds(tx: Tx, teamId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.teamId, teamId), eq(leads.status, 'open'), eq(leads.awaitingHandler, true)))
    .orderBy(asc(leads.firstAssignedAt));
  return rows.map((r) => r.id);
}

// ── notifications ───────────────────────────────────────────────────────

export async function listNotifications(tx: Tx, userId: string, limit: number) {
  return tx
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
}

export async function unreadCount(tx: Tx, userId: string): Promise<number> {
  const res = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from notifications where user_id = ${userId} and read_at is null`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function markRead(tx: Tx, userId: string, ids: readonly string[] | 'all'): Promise<number> {
  const where = [eq(notifications.userId, userId), isNull(notifications.readAt)];
  if (ids !== 'all') where.push(inArray(notifications.id, [...ids]));
  const res = await tx
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(...where))
    .returning({ id: notifications.id });
  return res.length;
}

// ── timers (SECURITY DEFINER, cross-workspace ids only) ─────────────────

const arr = (v?: readonly string[]) => (v?.length ? `{${v.join(',')}}` : null);

export async function claimDueTimers(
  tx: Tx,
  limit: number,
  workspaceIds?: readonly string[],
): Promise<{ id: string; workspaceId: string }[]> {
  const res = await tx.execute<{ id: string; workspace_id: string }>(
    sql`select * from relay_lead_timers_claim(${limit}::int, ${arr(workspaceIds)}::uuid[])`,
  );
  return res.rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id }));
}

export async function nextDueTimer(tx: Tx, workspaceIds?: readonly string[]): Promise<Date | null> {
  const res = await tx.execute<{ at: Date | string | null }>(
    sql`select relay_lead_timers_next_due(${arr(workspaceIds)}::uuid[]) as at`,
  );
  const at = res.rows[0]?.at;
  return at ? new Date(at) : null;
}
