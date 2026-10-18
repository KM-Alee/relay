// scheduler_state (singleton) data access: the next QStash wake we believe is scheduled.
// Global table (no RLS). Reservation pattern (core/jobs/scheduler.ts):
//   tx1 reserve (row lock, conditional) → commit → publish to QStash (no tx) → tx2 record/release.
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';

export interface WakeState {
  nextWakeAt: Date | null;
  messageId: string | null;
}

const date = (v: Date | string | null) => (v === null ? null : new Date(v));

export async function get(tx: Tx): Promise<WakeState> {
  const res = await tx.execute<{ next_wake_at: Date | string | null; qstash_message_id: string | null }>(
    sql`select next_wake_at, qstash_message_id from scheduler_state where id`,
  );
  const r = res.rows[0];
  return { nextWakeAt: date(r?.next_wake_at ?? null), messageId: r?.qstash_message_id ?? null };
}

/**
 * True when a wake at `at` is still needed: no wake is scheduled, the scheduled one is in the past
 * (already fired, or lost), or `at` is earlier. Uses the DB clock.
 */
export async function needsWake(tx: Tx, at: Date): Promise<boolean> {
  const res = await tx.execute<{ needed: boolean }>(sql`
    select (next_wake_at is null or next_wake_at <= now() or ${at}::timestamptz < next_wake_at) as needed
      from scheduler_state where id
  `);
  return res.rows[0]?.needed ?? true;
}

/** Lock the singleton and, if a wake at `at` is needed, claim it. Returns the previous state. */
export async function reserve(tx: Tx, at: Date): Promise<{ reserved: boolean; previous: WakeState }> {
  const res = await tx.execute<{
    next_wake_at: Date | string | null;
    qstash_message_id: string | null;
    needed: boolean;
  }>(sql`
    select next_wake_at, qstash_message_id,
           (next_wake_at is null or next_wake_at <= now() or ${at}::timestamptz < next_wake_at) as needed
      from scheduler_state where id for update
  `);
  const r = res.rows[0];
  const previous = { nextWakeAt: date(r?.next_wake_at ?? null), messageId: r?.qstash_message_id ?? null };
  if (!r?.needed) return { reserved: false, previous };
  await tx.execute(
    sql`update scheduler_state set next_wake_at = ${at}::timestamptz, qstash_message_id = null where id`,
  );
  return { reserved: true, previous };
}

/** Record the provider message id, only if our reservation is still the current one. */
export async function recordMessage(tx: Tx, at: Date, messageId: string): Promise<boolean> {
  const res = await tx.execute(sql`
    update scheduler_state set qstash_message_id = ${messageId}
     where id and next_wake_at = ${at}::timestamptz and qstash_message_id is null
  `);
  return (res.rowCount ?? 0) === 1;
}

/** Publishing failed: restore the previous state if our reservation is still the current one. */
export async function release(tx: Tx, at: Date, previous: WakeState): Promise<boolean> {
  const res = await tx.execute(sql`
    update scheduler_state set next_wake_at = ${previous.nextWakeAt}::timestamptz,
                               qstash_message_id = ${previous.messageId}
     where id and next_wake_at = ${at}::timestamptz and qstash_message_id is null
  `);
  return (res.rowCount ?? 0) === 1;
}

/** Clear the scheduled wake (Judge "lose the doorbell", or after cancelling it at the provider). */
export async function clear(tx: Tx): Promise<WakeState> {
  const prev = await get(tx);
  await tx.execute(sql`update scheduler_state set next_wake_at = null, qstash_message_id = null where id`);
  return prev;
}

/** At most one maintenance pass per `intervalSeconds` across all instances. */
export async function claimMaintenance(tx: Tx, intervalSeconds: number): Promise<boolean> {
  const res = await tx.execute(sql`
    update scheduler_state set last_maintenance_at = now()
     where id and (last_maintenance_at is null
                   or last_maintenance_at < now() - make_interval(secs => ${intervalSeconds}))
  `);
  return (res.rowCount ?? 0) === 1;
}
