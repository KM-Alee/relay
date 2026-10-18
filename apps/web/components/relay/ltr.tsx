// LTR island for phone numbers, emails, amounts, IDs, URLs and mm:ss timers inside RTL text (docs/07 §6).
import type { ComponentProps } from 'react';

export function Ltr({ children, ...props }: ComponentProps<'bdi'>) {
  return (
    <bdi dir="ltr" {...props}>
      {children}
    </bdi>
  );
}
