import { describe, expect, it } from 'vitest';
import {
  BACKOFF_CAP_MS,
  decideFailure,
  DeferJobError,
  errorText,
  InvalidJobPayloadError,
  PermanentJobError,
  retryDelayMs,
  UnknownJobTypeError,
} from './policy';

const mid = () => 0.5; // jitter factor exactly 1.0
const low = () => 0; // −20 %
const high = () => 0.999_999; // ≈ +20 %
const now = new Date('2026-10-18T10:00:00Z');

describe('[I5.5] outbox retry backoff', () => {
  it.each([
    [1, 4_000],
    [2, 8_000],
    [3, 16_000],
    [5, 64_000],
    [8, 512_000],
    [9, BACKOFF_CAP_MS], // 1 024 s capped at 10 min
    [20, BACKOFF_CAP_MS],
  ])('[I5.5] attempt %i → min(2^n × 2 s, 10 min) = %i ms (no jitter)', (attempt, expected) => {
    expect(retryDelayMs(attempt, mid)).toBe(expected);
  });

  it('[I5.5] jitter stays within ±20 %', () => {
    expect(retryDelayMs(3, low)).toBe(12_800);
    expect(retryDelayMs(3, high)).toBeGreaterThan(19_199);
    expect(retryDelayMs(3, high)).toBeLessThanOrEqual(19_200);
    for (let i = 0; i < 200; i++) {
      const d = retryDelayMs(4);
      expect(d).toBeGreaterThanOrEqual(25_600);
      expect(d).toBeLessThanOrEqual(38_400);
    }
  });
});

describe('[I5.5] [Q5] failure decisions', () => {
  const temporary = Object.assign(new Error('503'), { kind: 'temporary' });
  const permanent = Object.assign(new Error('400'), { kind: 'permanent' });
  const auth = Object.assign(new Error('invalid_grant'), { kind: 'auth' });
  const slowDown = Object.assign(new Error('429'), { kind: 'temporary', retryAfterMs: 120_000 });

  it.each([
    ['plain error, attempt 1/6', new Error('boom'), 1, 6, 'pending', 4_000, true],
    ['ProviderError temporary, attempt 2/6', temporary, 2, 6, 'pending', 8_000, true],
    ['retryAfterMs beats a shorter backoff', slowDown, 1, 6, 'pending', 120_000, true],
    ['last attempt → dead', new Error('boom'), 6, 6, 'dead', null, true],
    ['PermanentJobError → failed', new PermanentJobError('nope'), 1, 6, 'failed', null, true],
    ['ProviderError permanent → failed', permanent, 1, 6, 'failed', null, true],
    ['ProviderError auth → failed', auth, 1, 6, 'failed', null, true],
    ['invalid payload → dead (never retried)', new InvalidJobPayloadError('x'), 1, 6, 'dead', null, true],
    ['unknown type → retried (deploy skew)', new UnknownJobTypeError('x.y'), 1, 6, 'pending', 4_000, true],
    ['unknown type on last attempt → dead', new UnknownJobTypeError('x.y'), 6, 6, 'dead', null, true],
    [
      'DeferJobError → later, attempt NOT consumed',
      new DeferJobError(30_000),
      6,
      6,
      'pending',
      30_000,
      false,
    ],
  ] as const)('[I5.5] %s', (_name, err, attempt, maxAttempts, status, delay, consume) => {
    const d = decideFailure({ err, attempt, maxAttempts, now, random: mid });
    expect(d.status).toBe(status);
    expect(d.consumeAttempt).toBe(consume);
    if (delay === null) expect(d.availableAt).toBeUndefined();
    else expect(d.availableAt!.getTime() - now.getTime()).toBe(delay);
  });

  it('[I5.5] defer delay is clamped to [1 s, 10 min]', () => {
    const tiny = decideFailure({ err: new DeferJobError(0), attempt: 1, maxAttempts: 6, now });
    const huge = decideFailure({ err: new DeferJobError(1e9), attempt: 1, maxAttempts: 6, now });
    expect(tiny.availableAt!.getTime() - now.getTime()).toBe(1_000);
    expect(huge.availableAt!.getTime() - now.getTime()).toBe(BACKOFF_CAP_MS);
  });

  it('[Q13] error text is one bounded line, no stack', () => {
    const e = new Error('line1\n   line2');
    expect(errorText(e)).toBe('Error: line1 line2');
    expect(errorText('x'.repeat(5000))).toHaveLength(1000);
    expect(errorText({})).toBe('non-error thrown');
  });
});
