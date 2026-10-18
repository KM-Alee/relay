// In-app notification centre (F3.4). Owner: Lane A. Own notifications only.
import type { NotificationDto, NotificationsResponse } from '@relay/contracts/api/notifications';
import { withWorkspaceTx, type TxOptions } from '@relay/db';
import type { Actor } from '../auth/actor';
import * as repo from '../repos/leads';

export async function list(actor: Actor, opts: TxOptions = {}): Promise<NotificationsResponse> {
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const rows = await repo.listNotifications(tx, actor.userId, 50);
      return {
        items: rows.map((n): NotificationDto => ({
          id: n.id,
          type: n.type as NotificationDto['type'],
          leadId: n.leadId,
          params: (n.params ?? {}) as Record<string, unknown>,
          readAt: n.readAt ? n.readAt.toISOString() : null,
          createdAt: n.createdAt.toISOString(),
        })),
        unreadCount: await repo.unreadCount(tx, actor.userId),
      };
    },
    opts,
  );
}

export async function markRead(
  actor: Actor,
  input: { ids: string[] } | { all: true },
  opts: TxOptions = {},
): Promise<{ updated: number; unreadCount: number }> {
  return withWorkspaceTx(
    actor.workspaceId,
    async (tx) => {
      const updated = await repo.markRead(tx, actor.userId, 'all' in input ? 'all' : input.ids);
      return { updated, unreadCount: await repo.unreadCount(tx, actor.userId) };
    },
    opts,
  );
}

export const notificationsService = { list, markRead };
