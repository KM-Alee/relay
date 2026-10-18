import type { ReactNode } from 'react';

// Pass-through root layout: <html>/<body> are rendered by app/[locale]/layout.tsx (lang/dir per
// locale) and app/f/layout.tsx (public form, no locale prefix). app/not-found.tsx covers the rest.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
