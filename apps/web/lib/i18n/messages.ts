// Loads every namespace for a locale into one next-intl messages object `{ [namespace]: {...} }`.
// Usage in components: `useTranslations('leads')` / `getTranslations('leads')`.
import { NAMESPACES, type Namespace } from './namespaces';
import type { Locale } from './routing';

export type Messages = Record<Namespace, Record<string, unknown>>;

export async function loadMessages(locale: Locale): Promise<Messages> {
  const entries = await Promise.all(
    NAMESPACES.map(
      async (ns) =>
        [
          ns,
          ((await import(`../../messages/${locale}/${ns}.json`)) as { default: Record<string, unknown> })
            .default,
        ] as const,
    ),
  );
  return Object.fromEntries(entries) as Messages;
}
