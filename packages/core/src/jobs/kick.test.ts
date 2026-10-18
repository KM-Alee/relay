import { describe, expect, it, vi } from 'vitest';
import { createKicker } from './kick';
import type { RunDueWorkOptions, TickResult } from './run-due-work';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('[Q5] after()/nudge kick coalescing (one instance)', () => {
  it('[Q5] overlapping kicks share one run, then exactly one rerun picks up later commits', async () => {
    const gates = [deferred(), deferred()];
    const calls: RunDueWorkOptions[] = [];
    const run = vi.fn(async (o: RunDueWorkOptions) => {
      calls.push(o);
      await gates[calls.length - 1]!.promise;
      return {} as TickResult;
    });
    const k = createKicker(run, () => 1234);

    const a = k.kick('after');
    const b = k.kick('after');
    const c = k.kick('nudge');
    expect(run).toHaveBeenCalledTimes(1);
    gates[0]!.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    gates[1]!.resolve();
    await Promise.all([a, b, c]);

    expect(k.runs).toBe(2);
    expect(calls.map((x) => x.trigger)).toEqual(['after', 'nudge']);
    expect(calls.every((x) => x.budgetMs === 1234)).toBe(true);
  });

  it('[Q5] a failing run never throws into the request, and the next kick starts fresh', async () => {
    const run = vi.fn(async () => {
      throw new Error('db down');
    });
    const k = createKicker(run, () => 10);
    await expect(k.kick()).resolves.toBeUndefined();
    await expect(k.kick()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
