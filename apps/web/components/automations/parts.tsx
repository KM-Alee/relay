'use client';
// Small form primitives for the automations screens (tokens only, logical properties, 44px touch targets).
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { fieldClass, Input } from '@/components/ui/input';
import { useFormat } from '@/lib/format/use-format';

export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <span className="relative block">
      <select {...props} className={cn(fieldClass, 'h-11 appearance-none pe-9 sm:h-10', className)}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-fg-2"
      />
    </span>
  );
}

/** role="switch" toggle. State is also shown as text next to it (colour is never the only signal). */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  stateLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  stateLabel?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex min-h-11 items-center gap-3 rounded-control disabled:opacity-50 sm:min-h-10"
    >
      <span
        aria-hidden
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-chip border transition-colors duration-(--dur-fast)',
          checked ? 'border-brand-strong bg-brand-strong' : 'border-line-strong bg-surface-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-chip bg-surface shadow-card transition-all duration-(--dur-fast)',
            checked ? 'start-[1.375rem]' : 'start-0.5',
          )}
        />
      </span>
      {stateLabel ? <span className="text-body text-fg">{stateLabel}</span> : null}
    </button>
  );
}

type Unit = 'second' | 'minute' | 'hour';
const MULT: Record<Unit, number> = { second: 1, minute: 60, hour: 3600 };
const unitFor = (s: number): Unit =>
  s >= 3600 && s % 3600 === 0 ? 'hour' : s >= 60 && s % 60 === 0 ? 'minute' : 'second';

/** "2 min" / "5 min 30 sec" via Intl (en + ur). */
export function formatDuration(locale: string, seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const DF = (
    Intl as unknown as { DurationFormat?: new (l: string, o: object) => { format(d: object): string } }
  ).DurationFormat;
  if (DF) return new DF(locale, { style: 'short' }).format({ hours: h, minutes: m, seconds: sec });
  const unit = unitFor(s);
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(s / MULT[unit]);
}

export function useDuration() {
  const { locale } = useFormat();
  return (seconds: number): string => formatDuration(locale, seconds);
}

/** Seconds ⇄ amount + unit. Keyboard-usable, labelled. */
export function DurationField({
  value,
  onChange,
  label,
  min = 1,
  max = 7 * 86400,
  invalid,
}: {
  value: number;
  onChange: (seconds: number) => void;
  label: string;
  min?: number;
  max?: number;
  invalid?: boolean;
}) {
  const t = useTranslations('automations.duration');
  const id = useId();
  const [unit, setUnit] = useState<Unit>(unitFor(value));
  const amount = Math.round((value / MULT[unit]) * 100) / 100;
  return (
    <div className="flex items-center gap-2" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`} className="sr-only">
        {label}
      </span>
      <Input
        inputMode="decimal"
        type="number"
        dir="ltr"
        min={min / MULT[unit]}
        max={max / MULT[unit]}
        step="any"
        value={Number.isFinite(amount) ? amount : ''}
        aria-label={`${label} (${t('amount')})`}
        aria-invalid={invalid || undefined}
        className="w-24 tabular"
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(0, Math.round(n * MULT[unit]))));
        }}
      />
      <NativeSelect
        value={unit}
        aria-label={`${label} (${t('unit')})`}
        className="w-28"
        onChange={(e) => setUnit(e.target.value as Unit)}
      >
        <option value="second">{t('second')}</option>
        <option value="minute">{t('minute')}</option>
        <option value="hour">{t('hour')}</option>
      </NativeSelect>
    </div>
  );
}
