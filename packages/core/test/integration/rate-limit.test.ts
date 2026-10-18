// [Q1][Q3] DB-backed fixed-window limiter on real Postgres, as app_user.
import { randomUUID } from 'node:crypto';
import { closeDb } from '@relay/db';
import { afterAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors';
import { consume, enforce } from '../../src/services/rate-limit';

afterAll(async () => {
  await closeDb();
});

describe('[Q1] rate limiter', () => {
  it('[Q1] allows up to the limit in a window, then blocks with retryAfter', async () => {
    const rule = { key: `test:login:ip:${randomUUID()}`, limit: 3, windowSeconds: 900 };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await consume(rule));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4, 5]);
    expect(results[4]!.retryAfterSeconds).toBeGreaterThan(0);
    expect(results[4]!.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it('[Q1] concurrent hits from many instances are counted exactly (no lost updates)', async () => {
    const rule = { key: `test:nudge:${randomUUID()}`, limit: 6, windowSeconds: 60 };
    const results = await Promise.all(Array.from({ length: 10 }, () => consume(rule)));
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(results.filter((r) => r.allowed)).toHaveLength(6);
  });

  it('[Q1] keys are independent', async () => {
    const a = { key: `test:a:${randomUUID()}`, limit: 1, windowSeconds: 60 };
    const b = { ...a, key: `test:b:${randomUUID()}` };
    await consume(a);
    expect((await consume(a)).allowed).toBe(false);
    expect((await consume(b)).allowed).toBe(true);
  });

  it('[Q1] enforce throws 429 RATE_LIMITED with retryAfter', async () => {
    const rule = { key: `test:enforce:${randomUUID()}`, limit: 1, windowSeconds: 60 };
    await enforce(rule);
    const err = await enforce(rule).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'RATE_LIMITED', httpStatus: 429 });
    expect((err as AppError).details?.retryAfter).toEqual(expect.any(Number));
  });
});
