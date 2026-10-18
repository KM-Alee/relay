'use client';
// Shared frame for the AI admin pages (T-208): page header + in-page tabs (behaviour / knowledge / templates).
// Tokens only, logical properties only, all strings from the `ai` namespace.
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/relay/page-header';
import { cn } from '@/components/ui/cn';
import { Link } from '@/lib/i18n/navigation';

const TABS = [
  ['settings', '/settings/ai'],
  ['knowledge', '/settings/knowledge'],
  ['templates', '/settings/templates'],
] as const;

export type AiAdminTab = (typeof TABS)[number][0];

export function AiAdminShell({ active, children }: { active: AiAdminTab; children: ReactNode }) {
  const t = useTranslations('ai.admin');
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 sm:px-6">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <nav
        aria-label={t('tabs.label')}
        className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-control bg-surface-muted p-1"
      >
        {TABS.map(([id, href]) => (
          <Link
            key={id}
            href={href}
            aria-current={id === active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-10 items-center whitespace-nowrap rounded-control px-4 text-button transition-colors',
              id === active ? 'bg-surface text-fg shadow-card' : 'text-fg-2 hover:text-fg',
            )}
          >
            {t(`tabs.${id}`)}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}

/** Native checkbox styled as a labelled row (accessible without extra deps). */
export function Toggle({
  checked,
  onChange,
  label,
  helper,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  helper?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start gap-3', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-brand-strong"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-body font-medium text-fg">{label}</span>
        {helper ? <span className="text-meta text-fg-2">{helper}</span> : null}
      </span>
    </label>
  );
}
