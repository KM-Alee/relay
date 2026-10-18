// notifications API contracts: Zod request/response schemas + endpoint descriptors (docs/11-api.md). Owner: Lane A.
// In-app notification centre with unread count (F3.4).
import { z } from 'zod';
import { endpoint } from './endpoint';

export const notificationTypeSchema = z.enum([
  'lead.assigned',
  'lead.escalated',
  'lead.reassigned',
  'lead.critical',
  'lead.claimable',
]);

export const notificationDto = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  leadId: z.uuid().nullable(),
  /** i18n params, e.g. {contactName, awaitingReason, level}. */
  params: z.record(z.string(), z.unknown()),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type NotificationDto = z.infer<typeof notificationDto>;

export const notificationsResponse = z.object({
  items: z.array(notificationDto),
  unreadCount: z.number().int(),
});
export type NotificationsResponse = z.infer<typeof notificationsResponse>;

export const markReadInput = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export const markReadResponse = z.object({ updated: z.number().int(), unreadCount: z.number().int() });

export const notificationsEndpoints = {
  /** GET /api/v1/notifications: own latest 50 + unread count. */
  list: endpoint({ method: 'GET', path: '/api/v1/notifications', response: notificationsResponse }),
  /** POST /api/v1/notifications/read: mark some or all own notifications read. */
  markRead: endpoint({
    method: 'POST',
    path: '/api/v1/notifications/read',
    body: markReadInput,
    response: markReadResponse,
  }),
} as const;
