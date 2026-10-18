'use client';
// Shared bits for the CRM screens (Lane B). Plain semantic markup + design-token CSS variables only
// (docs/design/tokens.md): no raw colours, logical properties only. Lane D restyles via components/relay.
import type { CustomFieldDto, FieldValue, OpportunityDto } from '@relay/contracts/api/crm';
import type { MeResponse } from '@relay/contracts/api/users';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, localizeError } from '@/lib/api-client';

export const ui = {
  page: 'mx-auto max-w-6xl space-y-4 px-4 py-6',
  h1: 'text-2xl font-semibold text-[var(--text-primary)]',
  h2: 'text-lg font-semibold text-[var(--text-primary)]',
  muted: 'text-sm text-[var(--text-secondary)]',
  input:
    'min-h-10 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--text-primary)]',
  btn: 'min-h-10 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1 text-sm text-[var(--text-primary)]',
  btnPrimary: 'min-h-10 rounded-md bg-[var(--brand-strong)] px-3 py-1 text-sm text-[var(--on-brand-strong)]',
  btnDanger: 'min-h-10 rounded-md border border-[var(--danger)] px-3 py-1 text-sm text-[var(--danger)]',
  card: 'rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3',
  panel: 'rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3',
  table: 'w-full border-collapse text-sm',
  th: 'border-b border-[var(--border)] px-2 py-1 text-start font-medium text-[var(--text-secondary)]',
  td: 'border-b border-[var(--border)] px-2 py-1 text-start',
  chip: 'inline-flex items-center gap-1 rounded-full bg-[var(--neutral-surface)] px-2 py-0.5 text-xs text-[var(--text-primary)]',
  aiChip: 'inline-flex rounded-full bg-[var(--ai-surface)] px-2 py-0.5 text-xs text-[var(--ai)]',
  alert:
    'rounded-md border border-[var(--danger)] bg-[var(--danger-surface)] p-2 text-sm text-[var(--danger)]',
  info: 'rounded-md border border-[var(--info)] bg-[var(--info-surface)] p-2 text-sm text-[var(--info)]',
  row: 'flex flex-wrap items-center gap-2',
} as const;

/** Load data once per `key` change; keeps the previous data while reloading. */
export function useLoad<T>(fn: () => Promise<T>, key: string) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const [res, setRes] = useState<{ data: T | null; error: unknown }>({ data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fnRef.current().then(
      (data) => live && setRes({ data, error: null }),
      (error) => live && setRes((r) => ({ ...r, error })),
    );
    return () => {
      live = false;
    };
  }, [key, tick]);
  return {
    data: res.data,
    error: res.error,
    loading: res.data === null && !res.error,
    reload: () => setTick((n) => n + 1),
  };
}

let mePromise: Promise<MeResponse> | null = null;
/** The signed-in user + effective permissions (UI hides controls; the server enforces). */
export function useMe(): MeResponse | null {
  return useLoad(() => (mePromise ??= api.users.me()), 'me').data;
}
export const has = (me: MeResponse | null, key: string) =>
  !!me && (me.user.baseLevel === 'owner' || (me.permissions as string[]).includes(key));

/** Localized message for any thrown API error. */
export function useErrorText() {
  const t = useTranslations();
  return (e: unknown) => localizeError(e, t as never);
}

export function ErrorNote({ error }: { error: unknown }) {
  const text = useErrorText();
  return error ? (
    <p role="alert" className={ui.alert}>
      {text(error)}
    </p>
  ) : null;
}

/** Opportunity value: masked server-side without the value permission (F1.4). */
export function Money({ value }: { value: OpportunityDto['value'] }) {
  const t = useTranslations('crm');
  const f = useFormatter();
  if (!value) return <span className="text-[var(--text-muted)]">{t('common.noValue')}</span>;
  if (value.masked)
    return (
      <span className="text-[var(--text-muted)]" title={t('common.maskedHint')}>
        {t('common.masked')}
      </span>
    );
  return (
    <span>
      {f.number(value.amountMinor / 100, {
        style: 'currency',
        currency: value.currency,
        maximumFractionDigits: 0,
      })}
    </span>
  );
}

export function useFieldLabel() {
  const locale = useLocale();
  return (f: Pick<CustomFieldDto, 'label'>) => (locale === 'ur' ? f.label.ur : f.label.en);
}

/** One custom-field input, by type (F2.2). `value` is the wire value. */
export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomFieldDto;
  value: FieldValue | undefined;
  onChange: (v: FieldValue | null) => void;
}) {
  const label = useFieldLabel();
  const locale = useLocale();
  const id = `f-${field.id}`;
  let control: ReactNode;
  if (field.type === 'checkbox')
    control = (
      <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
    );
  else if (field.type === 'dropdown')
    control = (
      <select
        id={id}
        className={ui.input}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="" />
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {locale === 'ur' ? o.label.ur : o.label.en}
          </option>
        ))}
      </select>
    );
  else if (field.type === 'number')
    control = (
      <input
        id={id}
        type="number"
        className={ui.input}
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  else if (field.type === 'date')
    control = (
      <input
        id={id}
        type="date"
        className={ui.input}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  else
    control = (
      <input
        id={id}
        className={ui.input}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={ui.muted}>
        {label(field)}
      </label>
      {control}
    </div>
  );
}

/** Display text for a stored field value. */
export function useFieldText() {
  const locale = useLocale();
  const t = useTranslations('crm');
  return (f: CustomFieldDto, v: FieldValue | undefined): string => {
    if (v === undefined) return '';
    if (f.type === 'checkbox') return v ? t('common.yes') : t('common.no');
    if (f.type === 'dropdown') {
      const o = f.options.find((x) => x.value === v);
      return o ? (locale === 'ur' ? o.label.ur : o.label.en) : String(v);
    }
    return String(v);
  };
}
