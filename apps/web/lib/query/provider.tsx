'use client';
// TanStack Query provider for the signed-in app (docs/07 §2). Mounted in (app)/layout.tsx.
// Lane C's `useRealtime(queryClient)` invalidates by topic (first key segment) from this client.
import { QueryClient, QueryClientProvider, isServer } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: 0 },
    },
  });
}

let browserClient: QueryClient | undefined;
/** One client per browser tab; a fresh one per server render (never share cache across requests). */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
