'use client';
// In-app notification centre data (F3.4). Owner: Lane A. Realtime hints on `notifications` refetch it.
import type { NotificationDto } from '@relay/contracts/api/notifications';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { NotificationItem } from '@/components/relay/notifications-panel';
import { api } from '@/lib/api-client';
import { qk } from './keys';

const KIND: Record<NotificationDto['type'], NotificationItem['kind']> = {
  'lead.assigned': 'ack',
  'lead.reassigned': 'ack',
  'lead.escalated': 'escalation',
  'lead.critical': 'escalation',
  'lead.claimable': 'info',
};

/** Unread notifications shaped for <NotificationsPanel items>. */
export function useNotificationItems(enabled = true): NotificationItem[] {
  const t = useTranslations('leads.notification');
  const q = useQuery({
    queryKey: qk.notifications(),
    queryFn: ({ signal }) => api.notifications.list({ signal }),
    enabled,
    retry: false,
  });
  return (q.data?.items ?? [])
    .filter((n) => !n.readAt)
    .map((n) => ({
      id: n.id,
      kind: KIND[n.type],
      title: t(n.type.replace(/^lead\./, ''), { contactName: String(n.params.contactName ?? '') }),
      href: n.leadId ? (`/leads/${n.leadId}` as const) : ('/leads' as const),
    }));
}
