// Audit log core (docs/06-security.md §6, F4.1, F4.3, F4.4). Owner: Lane B (T-007).
//
//   await audit.append(tx, actor, { action: 'role.updated', targetType: 'role', targetId: role.id,
//                                   before: { permissions: old }, after: { permissions: next } });
//
// - Call it INSIDE the use case's withWorkspaceTx, near the end (the per-workspace advisory lock taken by
//   the chain trigger is held until COMMIT).
// - `seq`, `prev_hash`, `hash` and `occurred_at` are computed by the DB trigger `audit_chain`: no code
//   path can skip the chain. The table is append-only (grants + triggers): there is no update/delete API.
// - `before`/`after` hold only the changed fields, already MASKED where protected (core/auth/mask.ts).
// - Actor: a request Actor (actor_type 'user'), or systemActor(ws) / aiActor(ws) for timers, webhooks, AI.
import type { Tx } from '@relay/db';
import { sql } from 'drizzle-orm';
import type { Actor } from '../auth/actor';

export type AuditActorType = 'user' | 'system' | 'ai';

export interface NonUserAuditActor {
  type: 'system' | 'ai';
  workspaceId: string;
}
export type AuditActor = Actor | NonUserAuditActor;

export const systemActor = (workspaceId: string): NonUserAuditActor => ({ type: 'system', workspaceId });
export const aiActor = (workspaceId: string): NonUserAuditActor => ({ type: 'ai', workspaceId });

/** Actions from 06 §6 (F4.1). Other `<entity>.<verb>` strings are accepted (DB checks the format). */
export type KnownAuditAction =
  | `lead.${'assigned' | 'escalated' | 'overdue_attempt' | 'reassigned' | 'claimed' | 'acknowledged' | 'idle_retriggered' | 'critical_flagged' | 'closed'}`
  | `user.${'invited' | 'joined' | 'level_changed' | 'roles_changed' | 'permissions_changed' | 'deactivated' | 'sessions_revoked' | 'availability_changed'}`
  | `role.${'created' | 'updated' | 'deleted'}`
  | `workspace.${'created' | 'settings_changed' | 'ownership_transferred' | 'time_warp_changed'}`
  | `integration.${'connected' | 'updated' | 'disconnected' | 'event_replayed'}`
  | 'routing.rules_changed'
  | 'escalation_policy.changed'
  | 'crm.exported'
  | 'crm.imported'
  | `${'contact' | 'company' | 'opportunity'}.deleted`
  | 'contact.opted_out'
  | `ai.${'settings_changed' | 'mode_changed' | 'standin_started' | 'standin_stopped' | 'handoff'}`
  | 'knowledge.changed'
  | 'template.changed'
  | 'judge.scenario_run';
export type AuditAction = KnownAuditAction | (string & {});

export interface AuditEntry {
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

export interface AppendedAudit {
  id: number;
  seq: number;
}

function actorColumns(actor: AuditActor): {
  type: AuditActorType;
  userId: string | null;
  workspaceId: string;
} {
  if ('type' in actor) return { type: actor.type, userId: null, workspaceId: actor.workspaceId };
  return { type: 'user', userId: actor.userId, workspaceId: actor.workspaceId };
}

const json = (v: Record<string, unknown> | null | undefined) => (v == null ? null : JSON.stringify(v));

/** Append one audit row in the caller's transaction. Returns its id and per-workspace seq. */
export async function append(tx: Tx, actor: AuditActor, entry: AuditEntry): Promise<AppendedAudit> {
  const a = actorColumns(actor);
  const res = await tx.execute<{ id: string | number; seq: string | number }>(sql`
    insert into audit_events (workspace_id, actor_type, actor_user_id, action, target_type, target_id, before, after, meta)
    values (${a.workspaceId}, ${a.type}::audit_actor_type, ${a.userId}, ${entry.action}, ${entry.targetType},
            ${entry.targetId ?? null}, ${json(entry.before)}::jsonb, ${json(entry.after)}::jsonb, ${json(entry.meta)}::jsonb)
    returning id, seq`);
  const row = res.rows[0];
  if (!row) throw new Error('audit append returned no row');
  return { id: Number(row.id), seq: Number(row.seq) };
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  firstBrokenSeq: number | null;
  expectedHash: string | null;
  storedHash: string | null;
}

const GENESIS: Buffer = Buffer.from([0]);
const hex = (b: Buffer | null) => (b ? b.toString('hex') : null);

/**
 * Recompute the workspace's chain in pages of `pageSize` rows (by seq), with the SAME SQL function the
 * trigger uses (`audit_row_hash`). Reports the first row whose content hash, previous-hash link or seq
 * does not match. Runs in the caller's transaction (RLS: the caller's workspace only).
 */
export async function verifyChain(tx: Tx, workspaceId: string, pageSize = 1000): Promise<VerifyResult> {
  let expectedSeq = 1;
  let expectedPrev: Buffer = GENESIS;
  let checked = 0;
  for (;;) {
    const res = await tx.execute<{
      seq: string | number;
      prev_hash: Buffer;
      hash: Buffer;
      recomputed: Buffer;
    }>(
      sql`select a.seq, a.prev_hash, a.hash, audit_row_hash(a) as recomputed
            from audit_events a
           where a.workspace_id = ${workspaceId} and a.seq >= ${expectedSeq}
           order by a.seq
           limit ${pageSize}`,
    );
    for (const row of res.rows) {
      const seq = Number(row.seq);
      checked++;
      if (seq !== expectedSeq) {
        // A row is missing (deleted by someone bypassing the triggers).
        return { ok: false, checked, firstBrokenSeq: expectedSeq, expectedHash: null, storedHash: null };
      }
      if (!row.prev_hash.equals(expectedPrev)) {
        return {
          ok: false,
          checked,
          firstBrokenSeq: seq,
          expectedHash: hex(expectedPrev),
          storedHash: hex(row.prev_hash),
        };
      }
      if (!row.recomputed.equals(row.hash)) {
        return {
          ok: false,
          checked,
          firstBrokenSeq: seq,
          expectedHash: hex(row.recomputed),
          storedHash: hex(row.hash),
        };
      }
      expectedPrev = row.hash;
      expectedSeq = seq + 1;
    }
    if (res.rows.length < pageSize)
      return { ok: true, checked, firstBrokenSeq: null, expectedHash: null, storedHash: null };
  }
}

export const audit = { append, verifyChain, systemActor, aiActor };
