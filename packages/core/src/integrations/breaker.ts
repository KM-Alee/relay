// Per-connection circuit breaker (I5.8). PURE: state in/out, `now` passed in.
// closed --5 consecutive temporary failures--> open --60 s--> half_open (one probe) --ok--> closed
//                                                              \--fail--> open
export interface Breaker {
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  openedAt: string | null;
}

export const BREAKER_THRESHOLD = 5;
export const BREAKER_HALF_OPEN_AFTER_MS = 60_000;

export const closedBreaker = (): Breaker => ({ state: 'closed', failures: 0, openedAt: null });

/** May a provider call be attempted now? Returns the (possibly half-open-transitioned) state. */
export function breakerAllows(b: Breaker, now: Date): { allow: boolean; next: Breaker; retryInMs: number } {
  if (b.state !== 'open') return { allow: true, next: b, retryInMs: 0 };
  const waited = now.getTime() - new Date(b.openedAt ?? 0).getTime();
  if (waited >= BREAKER_HALF_OPEN_AFTER_MS) {
    return { allow: true, next: { ...b, state: 'half_open' }, retryInMs: 0 };
  }
  return { allow: false, next: b, retryInMs: BREAKER_HALF_OPEN_AFTER_MS - waited };
}

export function breakerOnSuccess(): Breaker {
  return closedBreaker();
}

/** Only TEMPORARY failures count (a permanent error is the request's fault, not the provider's). */
export function breakerOnFailure(b: Breaker, now: Date): Breaker {
  if (b.state === 'half_open')
    return { state: 'open', failures: b.failures + 1, openedAt: now.toISOString() };
  const failures = b.failures + 1;
  return failures >= BREAKER_THRESHOLD
    ? { state: 'open', failures, openedAt: now.toISOString() }
    : { ...b, failures };
}
