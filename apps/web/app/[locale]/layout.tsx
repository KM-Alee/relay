// Localized root layout (F7.1–F7.3). Owner: Lane D.
// <html lang dir>, Inter + Noto Nastaliq Urdu via next/font, theme script (no flash), providers.
import type { Metadata } from 'next';
import { Inter, Noto_Nastaliq_Urdu } from 'next/font/google';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Providers } from '@/components/relay/providers';
import { ThemeScript } from '@/components/relay/theme-script';
import { cn } from '@/components/ui/cn';
import { dirOf, routing } from '@/lib/i18n/routing';
import '../globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const nastaliq = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-nastaliq',
  display: 'swap',
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return { title: 'Relay' };
  const t = await getTranslations({ locale, namespace: 'common' });
  return {
    title: { default: `${t('appName')} — ${t('tagline')}`, template: `%s · ${t('appName')}` },
    description: t('tagline'),
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    // suppressHydrationWarning: ThemeScript sets data-theme before React hydrates.
    <html
      lang={locale}
      dir={dirOf(locale)}
      suppressHydrationWarning
      className={cn(inter.variable, nastaliq.variable)}
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
