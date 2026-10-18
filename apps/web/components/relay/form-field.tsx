'use client';
// FormField (components.md §5): persistent label above, helper, error below with icon (aria-describedby),
// required marked in TEXT ("Required"), never colour or an asterisk alone.
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Label } from '@/components/ui/input';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}

export function FormField({
  label,
  helper,
  error,
  required,
  className,
  children,
}: {
  label: ReactNode;
  helper?: ReactNode;
  /** Localized message (from `localizeError`/field errors), shown with an icon. */
  error?: ReactNode;
  required?: boolean;
  className?: string;
  /** Render the control, spreading the given props onto it. */
  children: (props: FieldControlProps) => ReactNode;
}) {
  const t = useTranslations('common');
  const id = useId();
  const helperId = `${id}-help`;
  const errorId = `${id}-err`;
  const describedBy =
    [helper ? helperId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        {required ? <span className="text-meta text-fg-muted">{t('form.required')}</span> : null}
      </Label>
      {children({
        id,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(required ? { 'aria-required': true as const } : {}),
      })}
      {helper ? (
        <p id={helperId} className="text-meta text-fg-2">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-meta text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
