import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge our custom type/shape utilities so `cn('text-body', 'text-fg')` keeps both.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: ['hero', 'page', 'panel', 'kpi', 'body', 'meta', 'button', 'eyebrow'],
        },
      ],
      rounded: [{ rounded: ['card', 'control', 'chip'] }],
      shadow: [{ shadow: ['card', 'pop'] }],
    },
  },
});

/** Merge conditional class names; later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
