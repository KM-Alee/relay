// Signed-out pages (login, signup, invite accept). Owner: Lane B (T-101).
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div data-shell="auth">{children}</div>;
}
