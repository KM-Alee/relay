// Dev-only routes (13 §5). Owner: Lane D. Outside (app) so they work before sign-in.
// Guarded server-side: 404 unless NODE_ENV=development AND DEMO_MODE.
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { devToolsEnabled } from '@/lib/dev/guard';

export const dynamic = 'force-dynamic';

export default function DevLayout({ children }: { children: ReactNode }) {
  if (!devToolsEnabled()) notFound();
  return <div data-shell="dev">{children}</div>;
}
