'use client';
// Client providers shared by every localized page (theme, tooltips, toasts).
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/popover';
import { Toaster } from '@/components/ui/toaster';
import { MotionProvider } from './motion/provider';
import { ThemeProvider } from './theme';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <MotionProvider>
        <TooltipProvider delayDuration={250}>
          {children}
          <Toaster />
        </TooltipProvider>
      </MotionProvider>
    </ThemeProvider>
  );
}
