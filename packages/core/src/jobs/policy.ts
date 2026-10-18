// Outbox retry policy (docs/04-integrations.md §7, I5.5). PURE: no I/O, `now` and `random` passed in.
//
//   backoff   = min(2^attempt × 2 s, 10 min) ± 20 % jitter
//   temporary error (default)   → pending again at now + backoff, until max_attempts → 'dead'
//   PermanentJobError / ProviderError{kind:'permanent'|'auth'} → 'failed' immediately
//   InvalidJobPayloadError      → 'dead' immediately (retrying can never help)
//   UnknownJobTypeError         → retried like a temporary error (deploy skew: an older instance
//                                 may claim a row enqueued by newer code), so it dead-letters only
//                                 after max_attempts
//   DeferJobError               → pending at now + delay WITHOUT consuming an attempt
//                                 (e.g. circuit breaker open, I5.8)

export const DEFAULT_MAX_ATTEMPTS = 6;
/** In-flight lease (04 §7). A crashed delivery is reclaimed after this. */
export const DEFAULT_LEASE_SECONDS = 60;
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_CAP_MS = 10 * 60_000;
export const BACKOFF_JITTER = 0.2;

/** Retry delay after the `attempt`-th failed attempt (1-based). `random()` ∈ [0, 1). */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const base = Math.min(2 ** n * BACKOFF_BASE_MS, BACKOFF_CAP_MS);
  const jitter = 1 + (random() * 2 - 1) * BACKOFF_JITTER;
  return Math.round(base * jitter);
}

/** A handler says: this will never succeed (bad input, 4xx from a provider). → 'failed'. */
export class PermanentJobError extends Error {
  override readonly name = 'PermanentJobError';
}

/** Payload does not match the handler's schema. → 'dead'. */
export class InvalidJobPayloadError extends Error {
  override readonly name = 'InvalidJobPayloadError';
}

/** No handler registered for the row's type (deploy skew or a removed type). → retried. */
export class UnknownJobTypeError extends Error {
  override readonly name = 'UnknownJobTypeError';
  constructor(type: string) {
    super(`unknown job type: ${type}`);
  }
}

/** Not now, try again later without counting an attempt (breaker open, provider asked to wait). */
export class DeferJobError extends Error {
  override readonly name = 'DeferJobError';
  constructor(
    readonly delayMs: number,
    message = 'deferred',
  ) {
    super(message);
  }
}

export type FailureDecision =
  | { status: 'pending'; availableAt: Date; consumeAttempt: boolean }
  | { status: 'failed' | 'dead'; availableAt?: undefined; consumeAttempt: true };

function providerKind(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('kind' in err)) return undefined;
  const k = (err as { kind: unknown }).kind;
  return typeof k === 'string' ? k : undefined;
}

function retryAfterMs(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('retryAfterMs' in err)) return undefined;
  const v = (err as { retryAfterMs: unknown }).retryAfterMs;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * Decide what happens to a row whose `attempt`-th attempt threw `err`.
 * `attempt` is the attempt that just failed (row.attempts after the claim).
 */
export function decideFailure(input: {
  err: unknown;
  attempt: number;
  maxAttempts: number;
  now: Date;
  random?: () => number;
}): FailureDecision {
  const { err, attempt, maxAttempts, now } = input;
  const random = input.random ?? Math.random;

  if (err instanceof DeferJobError) {
    const delay = Math.min(Math.max(err.delayMs, 1_000), BACKOFF_CAP_MS);
    return { status: 'pending', availableAt: new Date(now.getTime() + delay), consumeAttempt: false };
  }
  if (err instanceof InvalidJobPayloadError) return { status: 'dead', consumeAttempt: true };
  const kind = providerKind(err);
  if (err instanceof PermanentJobError || kind === 'permanent' || kind === 'auth') {
    return { status: 'failed', consumeAttempt: true };
  }
  if (attempt >= maxAttempts) return { status: 'dead', consumeAttempt: true };
  const delay = Math.max(retryDelayMs(attempt, random), retryAfterMs(err) ?? 0);
  return { status: 'pending', availableAt: new Date(now.getTime() + delay), consumeAttempt: true };
}

/** Short, single-line error text for `outbox.last_error` (never a stack trace). */
export function errorText(err: unknown): string {
  const text =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : 'non-error thrown';
  return text.replace(/\s+/g, ' ').slice(0, 1000);
}
