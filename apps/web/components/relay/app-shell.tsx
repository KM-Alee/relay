'use client';
// AppShell: TopNav + main landmark for every signed-in page (screens.md §1). The nav is built from
// `visibleNav()` with the actor's permissions from `GET /api/v1/me` (api-client; fixture mode works).
// Hiding nav entries is a convenience only: every page and API enforces permissions server-side (F1.5).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { qk } from '@/lib/query/keys';
import { useAvailability } from '@/lib/query/use-availability';
import { useSignOut } from '@/lib/query/use-sign-out';
import { useRealtime } from '@/lib/realtime';
import { useNotificationItems } from '@/lib/query/use-notifications';
import { visibleNav } from '@/nav';
import { useTimeWarp } from '@/components/automations/use-automations';
import { PageTransition } from './motion/presence';
import { TopNav } from './top-nav';

export function AppShell({ children, demoMode = false }: { children: ReactNode; demoMode?: boolean }) {
  const t = useTranslations('common');
  const me = useQuery({ queryKey: qk.me(), queryFn: ({ signal }) => api.users.me({ signal }), retry: false });
  const availability = useAvailability();
  const queryClient = useQueryClient();
  const signOut = useSignOut();
  // ONE change-feed poller for the whole signed-in app (ADR-0003); screens add useRealtimeLive() for 1 s.
  useRealtime({ queryClient, enabled: me.isSuccess });
  const notifications = useNotificationItems(me.isSuccess); // Lane A (T-123)
  const warp = useTimeWarp(me.isSuccess); // Lane A (T-210): badge shows the real workspace multiplier

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
        user={
          me.data
            ? { name: me.data.user.name, email: me.data.user.email, workspace: me.data.workspace.name }
            : undefined
        }
        onSignOut={signOut.signOut}
        signingOut={signOut.pending}
        availability={availability.value}
        onAvailabilityChange={availability.setValue}
        notifications={notifications}
        timeWarp={warp.data?.multiplier}
      />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-(--shell-max) px-(--page-pad) pb-16 pt-2 outline-none"
      >
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
