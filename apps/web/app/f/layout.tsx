// Public web form root layout: no locale prefix, no auth (F3.1). Owner: Lane A (T-122).
// Language: English for now; a per-form/workspace locale (en/ur, RTL) is a follow-up.
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { loadMessages } from '@/lib/i18n/messages';
import '../globals.css';

export default async function PublicFormLayout({ children }: { children: ReactNode }) {
  setRequestLocale('en');
  const messages = await loadMessages('en');
  return (
    <html lang="en" dir="ltr">
      <body className="bg-canvas text-fg">
        <NextIntlClientProvider locale="en" messages={{ leads: messages.leads }}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
