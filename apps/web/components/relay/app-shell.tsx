'use client';
// AppShell: TopNav + main landmark for every signed-in page (screens.md §1). The nav is built from
// `visibleNav()` with the actor's permissions from `GET /api/v1/me` (api-client; fixture mode works).
// Hiding nav entries is a convenience only: every page and API enforces permissions server-side (F1.5).
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query/keys';
import { useAvailability } from '@/lib/query/use-availability';
import { useNotificationItems } from '@/lib/query/use-notifications';
import { visibleNav } from '@/nav';
import { TopNav } from './top-nav';

export function AppShell({ children, demoMode = false }: { children: ReactNode; demoMode?: boolean }) {
  const t = useTranslations('common');
  const me = useQuery({ queryKey: qk.me(), queryFn: ({ signal }) => api.users.me({ signal }), retry: false });
  const availability = useAvailability();
  const notifications = useNotificationItems(me.isSuccess); // Lane A (T-123)

  const items = useMemo(
    () =>
      visibleNav(new Set(me.data?.permissions ?? []), {
        isOwner: me.data?.user.baseLevel === 'owner',
        demoMode,
      }),
    [me.data, demoMode],
  );

  return (
    <div data-shell="app" className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-toast rounded-control bg-brand-strong px-4 py-2 text-button text-on-brand-strong focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        {t('shell.skipToContent')}
      </a>
      <TopNav
        items={items}
        loading={me.isPending}
        signedIn={me.isSuccess}
        roleLabel={me.data ? t(`role.${me.data.user.baseLevel}`) : undefined}
        availability={availability.value}
        onAvailabilityChange={availability.setValue}
        notifications={notifications}
      />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-(--shell-max) px-(--page-pad) pb-16 pt-2 outline-none"
      >
        {children}
      </main>
    </div>
  );
}
