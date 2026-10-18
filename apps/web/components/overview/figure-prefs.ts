'use client';
// Show / hide dashboard figures, remembered per user on this device (F5.5). External-store backed so
// every component sees the same value and SSR renders everything visible (no hydration mismatch).
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { FIGURE_IDS, type FigureId } from './helpers';

const EVENT = 'relay:overview-prefs';
const key = (userId: string) => `relay:overview:hidden:v1:${userId}`;

function read(userId: string): string {
  try {
    return window.localStorage.getItem(key(userId)) ?? '[]';
  } catch {
    return '[]';
  }
}

export function useHiddenFigures(userId: string | undefined) {
  const id = userId ?? 'anon';
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener(EVENT, cb);
    window.addEventListener('storage', cb);
    return () => {
      window.removeEventListener(EVENT, cb);
      window.removeEventListener('storage', cb);
    };
  }, []);
  const raw = useSyncExternalStore(
    subscribe,
    () => read(id),
    () => '[]',
  );
  const hidden = useMemo(() => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return new Set(
        (Array.isArray(parsed) ? parsed : []).filter((x): x is FigureId => FIGURE_IDS.includes(x)),
      );
    } catch {
      return new Set<FigureId>();
    }
  }, [raw]);

  const write = useCallback(
    (next: Set<FigureId>) => {
      try {
        window.localStorage.setItem(key(id), JSON.stringify([...next]));
      } catch {
        /* storage unavailable: the choice just won't persist */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [id],
  );
  const toggle = useCallback(
    (fig: FigureId) => {
      const next = new Set(hidden);
      if (next.has(fig)) next.delete(fig);
      else next.add(fig);
      write(next);
    },
    [hidden, write],
  );
  const reset = useCallback(() => write(new Set()), [write]);
  return { hidden, isHidden: (f: FigureId) => hidden.has(f), toggle, reset };
}
