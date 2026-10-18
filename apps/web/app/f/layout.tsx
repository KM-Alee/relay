// Public web form root layout: no locale prefix, no auth (F3.1). Owner: Lane A (T-122).
// T-122 picks the form's language from the form/workspace settings.
import type { ReactNode } from 'react';
import '../globals.css';

export default function PublicFormLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
