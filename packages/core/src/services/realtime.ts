// GET /api/v1/changes use case (T-009, Q11). Polled change feed; hints only.
import {
  REALTIME_MAX_CHANGES,
  REALTIME_RETENTION_SECONDS,
  REALTIME_TOPICS,
  type ChangesResponse,
  type RealtimeTopic,
} from '@relay/contracts/api/realtime';
import type { PermissionKey } from '@relay/contracts/permissions';
import { withWorkspaceTx } from '@relay/db';
import type { Actor } from '../auth/actor';
import { can } from '../auth/permissions';
import * as repo from '../repos/realtime-events';

/**
 * Cheap topic-level gating: a topic needs the permission that lets the user see that data at all.
 * Topics not listed are scoped by record visibility when the client refetches (hints hold ids only).
 * Per-record visibility (e.g. own leads only) is enforced by the refetch, never by the feed.
 */
export const TOPIC_PERMISSION: Partial<Record<RealtimeTopic, PermissionKey>> = {
  contacts: 'crm.contact.view',
  opportunities: 'crm.opportunity.view',
  recovery: 'leads.recovery.view',
  integrations: 'integrations.view',
  team: 'team.availability.view',
};

export function visibleTopics(actor: Actor): RealtimeTopic[] {
  return REALTIME_TOPICS.filter((t) => {
    const key = TOPIC_PERMISSION[t];
    return !key || can(actor, key);
  });
}

export const realtimeService = {
  /**
   * Hints after `since` for the actor's workspace (never another one), including those addressed to the
   * actor, filtered by topic permission. No `since` → just a cursor. A cursor older than the retention
   * window, or more than REALTIME_MAX_CHANGES hints, yields `reset: true` (client refetches everything).
   */
  async changes(actor: Actor, input: { since?: string }): Promise<ChangesResponse> {
    return withWorkspaceTx(actor.workspaceId, async (tx) => {
      const now = await repo.dbNow(tx);
      if (!input.since) return { now: now.toISOString(), reset: false, changes: [] };
      const since = new Date(input.since);
      if (await repo.isOlderThan(tx, since, REALTIME_RETENTION_SECONDS)) {
        return { now: now.toISOString(), reset: true, changes: [] };
      }
      const rows = await repo.listSince(tx, {
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        since,
        topics: visibleTopics(actor),
        limit: REALTIME_MAX_CHANGES + 1,
      });
      if (rows.length > REALTIME_MAX_CHANGES) return { now: now.toISOString(), reset: true, changes: [] };
      return {
        now: now.toISOString(),
        reset: false,
        changes: rows.map((r) => ({
          id: r.id,
          topic: r.topic as RealtimeTopic,
          ids: r.ids,
          at: r.at.toISOString(),
        })),
      };
    });
  },
};
