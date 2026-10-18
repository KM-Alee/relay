// Signed-out pages (login, signup, invite accept). Owner: Lane B (T-101); Lane D restyled the shell (markup only):
// split layout with the Relay brand panel (the pitch) beside the form.
import type { ReactNode } from 'react';
import { BrandPanel } from '@/components/relay/brand-panel';
import { LocaleSwitcher } from '@/components/relay/locale-switcher';
import { ThemeSwitcher } from '@/components/relay/theme-switcher';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-shell="auth"
      className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
    >
      <BrandPanel />
      <div className="flex min-h-[60dvh] flex-col px-(--page-pad) py-6 lg:min-h-dvh">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ThemeSwitcher />
          <LocaleSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center py-8">{children}</div>
      </div>
    </div>
  );
}
