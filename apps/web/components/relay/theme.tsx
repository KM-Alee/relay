'use client';
// Theme state: light | dark | system. `data-theme` on <html> is set before paint by ThemeScript; this
// provider keeps it in sync afterwards and persists the choice (later: users.ui_prefs).
// State lives in localStorage + the OS media query, read through useSyncExternalStore (no setState in effects).
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'relay-theme';
const MEDIA = '(prefers-color-scheme: dark)';

interface ThemeCtx {
  theme: ThemeChoice;
  resolved: 'light' | 'dark';
  setTheme: (t: ThemeChoice) => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'light'; // light is the default
  } catch {
    return 'light';
  }
}
const systemDark = () => window.matchMedia(MEDIA).matches;
const resolveTheme = (t: ThemeChoice): 'light' | 'dark' =>
  t === 'system' ? (systemDark() ? 'dark' : 'light') : t;
const apply = (t: ThemeChoice) => document.documentElement.setAttribute('data-theme', resolveTheme(t));

function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}
function subscribeSystem(cb: () => void) {
  const mq = window.matchMedia(MEDIA);
  const on = () => {
    apply(readTheme()); // follow OS changes while on "system"
    cb();
  };
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, (): ThemeChoice => 'light');
  const sysDark = useSyncExternalStore(subscribeSystem, systemDark, () => false);
  const resolved = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;

  const setTheme = useCallback((t: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* private mode: the choice applies for this page only */
    }
    apply(t);
    notify();
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>');
  return v;
}
