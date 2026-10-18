// Button (docs/design/components.md §5). One `primary` per view. Primary uses --brand-strong + white (AA).
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control text-button',
    'select-none transition-colors duration-(--dur-fast) ease-(--ease-standard)',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand-strong text-on-brand-strong hover:bg-brand-strong-hover',
        secondary: 'border border-line-strong bg-surface text-fg hover:bg-surface-muted',
        ghost: 'text-fg hover:bg-surface-muted',
        destructive: 'bg-danger text-on-danger hover:opacity-90',
        link: 'h-auto rounded-none p-0 text-brand-text underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3',
        md: 'h-11 px-4 sm:h-10',
        lg: 'h-11 px-5',
        icon: 'size-11 sm:size-10',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner, sets aria-busy and blocks clicks. Keep the label so the width doesn't jump. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}
