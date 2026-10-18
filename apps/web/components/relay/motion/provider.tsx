'use client';
// App-wide motion config: `reducedMotion="user"` makes every motion component drop transform/layout
// animation when the OS asks for reduced motion (belt and braces with useMotionOff()). Mounted in Providers.
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { T } from './tokens';

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={T.fade}>
      {children}
    </MotionConfig>
  );
}
