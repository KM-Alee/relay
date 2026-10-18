// Signed-in app shell. Owner: Lane D (T-012): TopNav from nav.ts + TanStack Query provider.
// T-101 (Lane B) adds the server-side session check here (redirect to /login when signed out).
import type { ReactNode } from 'react';
import { AppShell } from '@/components/relay/app-shell';
import { QueryProvider } from '@/lib/query/provider';

const truthy = (v: string | undefined) => ['1', 'true'].includes((v ?? '').trim().toLowerCase());

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AppShell demoMode={truthy(process.env.DEMO_MODE)}>{children}</AppShell>
    </QueryProvider>
  );
}
