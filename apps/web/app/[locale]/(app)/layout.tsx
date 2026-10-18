// Signed-in app shell. Owner: Lane D (T-012: TopNav from nav.ts, notifications, availability).
// T-101: server-side session check (signed out → /login). Gated pages add `await requirePage('<nav id>')`.
import type { ReactNode } from 'react';
import { requireActor } from '@/lib/http/page-auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireActor();
  return <div data-shell="app">{children}</div>;
}
