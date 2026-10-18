import { describe, expect, it } from 'vitest';
import { isPubliclyReachable, resolveWakeScheduler, sharedFakeWakeScheduler, tickUrl } from './index';

type Cfg = Parameters<typeof resolveWakeScheduler>[0];
const cfg = (jobs: Partial<Cfg['jobs']>, base = 'https://relay.example.com', fake = false): Cfg =>
  ({
    jobs: { TICK_BUDGET_MS: 20_000, ...jobs },
    core: { PUBLIC_BASE_URL: base },
    testing: { INTEGRATIONS_FAKE: fake },
  }) as Cfg;

describe('[Q5] WakeScheduler selection', () => {
  it('[Q5] INTEGRATIONS_FAKE → the shared fake', () => {
    expect(resolveWakeScheduler(cfg({ QSTASH_TOKEN: 't' }, undefined, true))).toBe(sharedFakeWakeScheduler);
  });

  it('[Q5] no QSTASH_TOKEN → disabled (dev ticker drives work)', () => {
    const s = resolveWakeScheduler(cfg({}));
    expect(s.kind).toBe('disabled');
    expect(s.enabled).toBe(false);
  });

  it('[Q5] a localhost PUBLIC_BASE_URL → disabled (QStash cannot reach it)', () => {
    expect(resolveWakeScheduler(cfg({ QSTASH_TOKEN: 't' }, 'http://localhost:3108')).kind).toBe('disabled');
  });

  it('[Q5] token + public URL → real QStash', () => {
    const s = resolveWakeScheduler(
      cfg({ QSTASH_TOKEN: 't', QSTASH_URL: 'https://qstash-eu-central-1.upstash.io' }),
    );
    expect(s.kind).toBe('qstash');
    expect(s.enabled).toBe(true);
  });

  it.each([
    ['https://relay.vercel.app', true],
    ['https://relay.example.com', true],
    ['http://localhost:3000', false],
    ['http://127.0.0.1:3000', false],
    ['http://app.localhost', false],
    ['http://192.168.1.5:3000', false],
    ['http://10.0.0.7', false],
  ])('[Q5] %s reachable from QStash: %s', (url, ok) => {
    expect(isPubliclyReachable(url)).toBe(ok);
  });

  it('[Q5] canonical tick URL ignores any path on PUBLIC_BASE_URL', () => {
    expect(tickUrl('https://relay.example.com')).toBe('https://relay.example.com/api/internal/tick');
    expect(tickUrl('https://relay.example.com/en/')).toBe('https://relay.example.com/api/internal/tick');
  });
});
