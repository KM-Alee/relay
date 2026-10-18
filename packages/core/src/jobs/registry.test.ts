import { describe, expect, it } from 'vitest';
import { getJobHandler, jobRegistry, runJob } from './registry';

const ctx = {
  jobId: 'j1',
  workspaceId: null,
  attempt: 1,
  maxAttempts: 6,
  now: new Date('2026-10-18T00:00:00Z'),
};

describe('job registry', () => {
  it('[Q14] resolves registered handlers by type', () => {
    expect(jobRegistry.has('system.noop')).toBe(true);
    expect(getJobHandler('system.noop').type).toBe('system.noop');
  });

  it('[Q14] every handler type follows <area>.<verb>', () => {
    for (const type of jobRegistry.keys()) expect(type).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it('[Q14] runs a handler with a validated payload', async () => {
    await expect(runJob('system.noop', { note: 'hi' }, ctx)).resolves.toBeUndefined();
  });

  it('[Q14] rejects an invalid payload and an unknown type', async () => {
    await expect(runJob('system.noop', { note: 42 }, ctx)).rejects.toThrow();
    await expect(runJob('nope.never', {}, ctx)).rejects.toThrow(/unknown job type/);
  });
});
