// Signed-in app shell. Owner: Lane D (T-012: TopNav from nav.ts, notifications, availability).
// T-101 adds the server-side session check here (redirect to /login when signed out).
import type { ReactNode } from 'react';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <div data-shell="app">{children}</div>;
}
