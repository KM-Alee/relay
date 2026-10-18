// Dev-only tools (/dev/login-as, /dev/kitchen-sink, /api/dev/*): 13 §5. Refused (404, never 403)
// unless NODE_ENV=development AND DEMO_MODE is on. Read from env at call time (not cached).
import { notFound } from '@relay/core/errors';

type Env = Record<string, string | undefined>;

export function devToolsEnabled(env: Env = process.env): boolean {
  const demo = (env.DEMO_MODE ?? '').trim().toLowerCase();
  return env.NODE_ENV === 'development' && (demo === '1' || demo === 'true');
}

/** For route handlers: throws AppError NOT_FOUND when dev tools are off. */
export function assertDevTools(env: Env = process.env): void {
  if (!devToolsEnabled(env)) throw notFound();
}
