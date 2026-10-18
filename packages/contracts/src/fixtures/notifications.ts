// Fixture builders for notifications contracts (13 §4). Owner: Lane A. Pattern: ./users.ts.
import type { NotificationDto } from '../api/notifications';
import { FIXTURE_LEAD_ID } from './leads';

export function buildNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: '0192f3a0-0000-7000-8000-00000000f001',
    type: 'lead.assigned',
    leadId: FIXTURE_LEAD_ID,
    params: { contactName: 'Kamran Butt' },
    readAt: null,
    createdAt: '2026-10-18T09:00:00.000Z',
    ...overrides,
  };
}

/** One entry per endpoint in notificationsEndpoints, used by the api-client in fixture mode. */
export const notificationsFixtures = {
  list: () => ({ items: [buildNotification()], unreadCount: 1 }),
  markRead: () => ({ updated: 1, unreadCount: 0 }),
} as const;
