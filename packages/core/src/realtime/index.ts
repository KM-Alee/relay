// realtime.emit(tx, {topic, ids}): change-feed hints (ADR-0003, docs/07 §2). Owner: Lane C (T-009).
//
// Call it INSIDE the transaction that changes the data, right after the write:
//
//   await withWorkspaceTx(actor.workspaceId, async (tx) => {
//     …update lead…
//     await emit(tx, { workspaceId: actor.workspaceId, topic: 'leads', ids: [lead.id] });
//   });
//
// The hint row commits (or rolls back) together with the change. It carries NO data, only
// {topic, ids}; clients refetch through the permissioned API, so masked fields can't leak.
import type { RealtimeTopic } from '@relay/contracts/api/realtime';
import { REALTIME_RETENTION_SECONDS, realtimeTopicSchema } from '@relay/contracts/api/realtime';
import type { Tx } from '@relay/db';
import { z } from 'zod';
import * as repo from '../repos/realtime-events';

export type { RealtimeTopic };

export interface EmitInput {
  /** The workspace of the transaction (must equal `app.workspace_id`, RLS enforces it). */
  workspaceId: string;
  topic: RealtimeTopic;
  /** Affected record ids (deduped). Empty = "the whole topic changed". */
  ids?: readonly string[];
  /** Deliver to one user only (e.g. `notifications`). Omit for the whole workspace. */
  userId?: string;
}

/** Matches the CHECK constraint on realtime_events.ids. */
export const MAX_IDS_PER_EVENT = 100;

const uuidSchema = z.uuid();

/** Insert hint rows (chunked at 100 ids). Never calls a provider. Returns the number of rows written. */
export async function emit(tx: Tx, input: EmitInput): Promise<number> {
  const topic = realtimeTopicSchema.parse(input.topic);
  const ids = [...new Set(input.ids ?? [])].map((i) => uuidSchema.parse(i));
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_EVENT) chunks.push(ids.slice(i, i + MAX_IDS_PER_EVENT));
  if (chunks.length === 0) chunks.push([]);
  for (const chunk of chunks) {
    await repo.insertEvent(tx, {
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      topic,
      ids: chunk,
    });
  }
  return chunks.length;
}

/**
 * Delete expired hints in every workspace. Lane A wires this into `runDueWork` (call it from a
 * `withSystemTx`, e.g. once per tick). Returns the number of rows deleted.
 */
export async function pruneRealtimeEvents(
  tx: Tx,
  olderThanSeconds: number = REALTIME_RETENTION_SECONDS,
): Promise<number> {
  return repo.prune(tx, olderThanSeconds);
}
