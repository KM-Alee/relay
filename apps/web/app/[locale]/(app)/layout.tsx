// Signed-in app shell. Owner: Lane D (T-012): TopNav from nav.ts + TanStack Query provider.
// T-101: server-side session check (signed out → /login). Gated pages add `await requirePage('<nav id>')`.
import type { ReactNode } from 'react';
import { AppShell } from '@/components/relay/app-shell';
import { requireActor } from '@/lib/http/page-auth';
import { QueryProvider } from '@/lib/query/provider';

export const dynamic = 'force-dynamic';

const truthy = (v: string | undefined) => ['1', 'true'].includes((v ?? '').trim().toLowerCase());

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireActor();
  return (
    <QueryProvider>
      <AppShell demoMode={truthy(process.env.DEMO_MODE)}>{children}</AppShell>
    </QueryProvider>
  );
}
