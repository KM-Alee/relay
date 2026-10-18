'use client';
// AvailabilitySwitcher (components.md §1, F3.2, F3.6): pill = dot + icon + label. On leave / offline asks for
// confirmation first, because unacknowledged leads will be reassigned. Controlled: the caller owns the state
// (optimistic mutation in lib/query/use-availability.ts).
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { ConfirmDialog } from './confirm-dialog';
import { AVAILABILITY_META, type Availability } from './owner-chip';

const ORDER: Availability[] = ['available', 'busy', 'onLeave', 'offline'];
const NEEDS_CONFIRM: ReadonlySet<Availability> = new Set(['onLeave', 'offline']);

/** Confirmation flow shared by every place that can change availability. Render `dialog` OUTSIDE any menu. */
export function useAvailabilityRequest(
  value: Availability,
  onChange: (next: Availability) => void,
): { request: (next: Availability) => void; dialog: ReactNode } {
  const t = useTranslations('common');
  const [pending, setPending] = useState<Availability | null>(null);
  const request = (next: Availability) => {
    if (next === value) return;
    if (NEEDS_CONFIRM.has(next)) setPending(next);
    else onChange(next);
  };
  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(o) => !o && setPending(null)}
      title={t('availability.confirmTitle', { status: pending ? t(`availability.${pending}`) : '' })}
      description={t('availability.confirmBody')}
      confirmLabel={t('actions.confirm')}
      onConfirm={() => {
        if (pending) onChange(pending);
        setPending(null);
      }}
    />
  );
  return { request, dialog };
}

/** The four options as radio items, for use inside any dropdown (user menu). */
export function AvailabilityRadioItems({
  value,
  onRequest,
}: {
  value: Availability;
  onRequest: (next: Availability) => void;
}) {
  const t = useTranslations('common');
  return (
    <>
      <DropdownMenuLabel>{t('availability.label')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(v) => onRequest(v as Availability)}>
        {ORDER.map((a) => (
          <DropdownMenuRadioItem key={a} value={a}>
            <Icon icon={AVAILABILITY_META[a].icon} className={AVAILABILITY_META[a].text} />
            {t(`availability.${a}`)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

export function AvailabilitySwitcher({
  value,
  onChange,
  disabled,
  className,
}: {
  value: Availability;
  onChange: (next: Availability) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('common');
  const { request, dialog } = useAvailabilityRequest(value, onChange);
  const meta = AVAILABILITY_META[value];
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={t('availability.change', { status: t(`availability.${value}`) })}
          className={cn(
            'inline-flex h-11 shrink-0 items-center gap-2 rounded-control border border-line bg-surface px-3 text-button text-fg transition-colors hover:bg-surface-muted disabled:opacity-60',
            className,
          )}
        >
          <span aria-hidden className={cn('size-2.5 rounded-chip', meta.dot)} />
          <Icon icon={meta.icon} className={meta.text} />
          <span>{t(`availability.${value}`)}</span>
          <Icon icon={ChevronDown} className="ms-auto text-fg-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <AvailabilityRadioItems value={value} onRequest={request} />
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  );
}
