import { describe, expect, it } from 'vitest';
import { clock, deadline, effectiveMs } from './clock';

const now = new Date('2026-10-18T10:00:00.000Z');

describe('[F10.2] clock.deadline (time-warp scales durations, never wall time)', () => {
  it.each([
    [1, 120, 120_000],
    ['1.00', 120, 120_000], // numeric column arrives as a string
    [60, 120, 2_000],
    [2.5, 45, 18_000],
    [0.5, 30, 60_000], // slow-motion is allowed (> 0)
    [60, 0, 0],
  ])('[F10.2] multiplier %s × %i s → +%i ms', (m, seconds, ms) => {
    expect(deadline({ timeWarpMultiplier: m }, seconds, now).getTime() - now.getTime()).toBe(ms);
  });

  it('[F10.2] a broken multiplier never produces an instant deadline (falls back to 1×)', () => {
    for (const m of [0, -5, Number.NaN, 'abc'])
      expect(effectiveMs({ timeWarpMultiplier: m }, 10)).toBe(10_000);
  });

  it('[F10.2] negative durations are rejected', () => {
    expect(() => effectiveMs({ timeWarpMultiplier: 1 }, -1)).toThrow();
  });

  it('[F10.2] clock.now is the real wall clock', () => {
    const before = Date.now();
    const t = clock.now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });
});
