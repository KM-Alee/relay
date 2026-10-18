// QStash WakeScheduler + tick signature verification (docs/01-architecture.md §6). Owner: Lane A (T-008).
// Selection (getWakeScheduler):
//   INTEGRATIONS_FAKE=1                          → shared FakeWakeScheduler (tests/local only)
//   QSTASH_TOKEN set and PUBLIC_BASE_URL public  → real QStash (QSTASH_URL = region endpoint)
//   otherwise                                    → disabled (local dev: scripts/dev-ticker.ts)
import { config as defaultConfig, type Config } from '../../config';
import { createQStashWakeScheduler } from './client';
import { createFakeWakeScheduler, disabledWakeScheduler, type FakeWakeScheduler } from './fake';
import type { TickVerifier, WakeScheduler } from './types';
import { createQStashVerifier } from './verify';

export * from './types';
export { BACKSTOP_SCHEDULE_ID, createQStashWakeScheduler, upsertBackstopSchedule } from './client';
export { createFakeWakeScheduler, disabledWakeScheduler, type FakeWakeScheduler } from './fake';
export { createQStashVerifier } from './verify';

export const TICK_PATH = '/api/internal/tick';

/** The canonical tick URL: what we publish to, what the schedule calls, what `sub` must equal. */
export function tickUrl(publicBaseUrl: string): string {
  return new URL(TICK_PATH, publicBaseUrl).toString();
}

/** QStash cannot call localhost / private dev hosts. */
export function isPubliclyReachable(publicBaseUrl: string): boolean {
  const host = new URL(publicBaseUrl).hostname;
  return !(
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host)
  );
}

type Cfg = Pick<Config, 'jobs' | 'core' | 'testing'>;

/** Shared fake (INTEGRATIONS_FAKE=1). Tests may inspect it. */
export const sharedFakeWakeScheduler: FakeWakeScheduler = createFakeWakeScheduler();

let override: WakeScheduler | undefined;
let cached: WakeScheduler | undefined;

export function resolveWakeScheduler(cfg: Cfg): WakeScheduler {
  if (cfg.testing.INTEGRATIONS_FAKE) return sharedFakeWakeScheduler;
  const token = cfg.jobs.QSTASH_TOKEN;
  if (!token) return disabledWakeScheduler;
  const base = cfg.core.PUBLIC_BASE_URL;
  if (!isPubliclyReachable(base)) return disabledWakeScheduler;
  return createQStashWakeScheduler({ token, baseUrl: cfg.jobs.QSTASH_URL, tickUrl: tickUrl(base) });
}

export function getWakeScheduler(cfg: Cfg = defaultConfig): WakeScheduler {
  if (override) return override;
  cached ??= resolveWakeScheduler(cfg);
  return cached;
}

/** Tests / Judge Console: swap the process-wide scheduler (undefined → back to env selection). */
export function setWakeScheduler(s: WakeScheduler | undefined): void {
  override = s;
  cached = undefined;
}

/** Signature verifier, or null when the signing keys are not configured (QStash calls → 401). */
export function getTickVerifier(cfg: Pick<Config, 'jobs'> = defaultConfig): TickVerifier | null {
  const { QSTASH_CURRENT_SIGNING_KEY: current, QSTASH_NEXT_SIGNING_KEY: next } = cfg.jobs;
  if (!current || !next) return null;
  return createQStashVerifier({ currentSigningKey: current, nextSigningKey: next });
}
