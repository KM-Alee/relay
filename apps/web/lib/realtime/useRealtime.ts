'use client';
// useRealtime(): mount ONCE in the app shell (Lane D), inside the TanStack Query provider:
//
//   const queryClient = useQueryClient();
//   const { status } = useRealtime({ queryClient, onChange: (c) => toastFor(c) });   // status 'paused' -> small indicator
//
// A screen that needs 1 s polling (Lead Radar, a visible countdown) calls `useRealtimeLive()`.
// Query keys must start with the topic ([topic, ...]; docs/07 §2), then a hint invalidates `[topic]`.
// `queryClient` is typed structurally, so this module has no hard dependency on @tanstack/react-query.
import type { RealtimeChange } from '@relay/contracts/api/realtime';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { acquireLive, isLive } from './live';
import { RealtimePoller, type RealtimeStatus } from './poller';

export interface InvalidatingClient {
  invalidateQueries: (filters?: { queryKey?: readonly unknown[] }) => unknown;
}

export interface UseRealtimeOptions {
  queryClient: InvalidatingClient;
  /** Set false to stop polling (e.g. signed out). Default true. */
  enabled?: boolean;
  /** Called for every new change (toasts, sound cues). */
  onChange?: (change: RealtimeChange) => void;
}

export function useRealtime({ queryClient, enabled = true, onChange }: UseRealtimeOptions): {
  status: RealtimeStatus;
} {
  const [status, setStatus] = useState<RealtimeStatus>('live');
  const onChangeRef = useRef(onChange);
  const clientRef = useRef(queryClient);
  useEffect(() => {
    onChangeRef.current = onChange;
    clientRef.current = queryClient;
  });

  useEffect(() => {
    if (!enabled) return;
    const poller = new RealtimePoller({
      fetchChanges: (since) => api.realtime.changes(since ? { since } : {}),
      onInvalidate: (hints) => {
        if (hints === 'all') clientRef.current.invalidateQueries();
        else for (const h of hints) clientRef.current.invalidateQueries({ queryKey: [h.topic] });
      },
      onChange: (c) => onChangeRef.current?.(c),
      onStatus: setStatus,
      isHidden: () => document.hidden,
      isLive,
    });
    const onVisibility = () => poller.visibilityChanged();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    poller.start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
      poller.stop();
    };
  }, [enabled]);

  return { status };
}

/** Request 1 s polling while this component is mounted (and `active`). */
export function useRealtimeLive(active = true): void {
  useEffect(() => {
    if (!active) return;
    return acquireLive();
  }, [active]);
}
