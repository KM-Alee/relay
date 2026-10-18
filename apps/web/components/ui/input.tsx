// Text inputs (components.md §5 FormField). 40-44px, --border-strong, visible focus ring (global).
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const fieldClass = cn(
  'block w-full rounded-control border border-line-strong bg-surface px-3 text-body text-fg',
  'placeholder:text-fg-muted transition-colors duration-(--dur-fast)',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60',
  'aria-invalid:border-danger',
);

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input data-slot="input" type={type} className={cn(fieldClass, 'h-11 sm:h-10', className)} {...props} />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(fieldClass, 'min-h-24 py-2', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  // The htmlFor association is supplied by the caller (FormField does it).
  return <label data-slot="label" className={cn('text-meta text-fg', className)} {...props} />;
}
