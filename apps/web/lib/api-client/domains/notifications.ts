// api.notifications.*: owner Lane A. One method per endpoint in contracts/api/notifications.ts; pattern: ./users.ts.
import { notificationsEndpoints } from '@relay/contracts/api/notifications';
import { notificationsFixtures } from '@relay/contracts/fixtures/notifications';
import { call, type CallOptions } from '../http';

export const notifications = {
  list: (opts?: CallOptions) =>
    call('notifications', notificationsEndpoints.list, {}, () => notificationsFixtures.list(), opts),
  markRead: (body: { ids: string[] } | { all: true }, opts?: CallOptions) =>
    call(
      'notifications',
      notificationsEndpoints.markRead,
      { body },
      () => notificationsFixtures.markRead(),
      opts,
    ),
};
