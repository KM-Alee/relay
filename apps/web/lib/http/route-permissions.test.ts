// [F1.5] Per-permission server-side enforcement: for EVERY catalogue key, a direct API call by an actor
// without it is 403 (handler never runs) and with it is 200. T-102.
import type { Actor } from '@relay/core/auth/actor';
import { LEVEL_DEFAULTS, PERMISSION_KEYS } from '@relay/core/auth/permissions';
import { describe, expect, it, vi } from 'vitest';
import { createRoute } from './route';

const base: Actor = {
  userId: '0192f0e2-0000-7000-8000-0000000000a1',
  workspaceId: '0192f0e2-0000-7000-8000-0000000000b1',
  sessionId: 's1',
  baseLevel: 'user',
  permissions: new Set(LEVEL_DEFAULTS.user),
  locale: 'en',
};

function make(actor: Actor) {
  return createRoute({
    resolveActor: async () => actor,
    rateLimiter: async (r) => ({ allowed: true, count: 1, limit: r.limit, retryAfterSeconds: 1 }),
    csrfSecret: () => 'x'.repeat(32),
    trustedOrigins: () => [],
    secureCookies: () => false,
    logError: vi.fn(),
  });
}

const call = (h: ReturnType<ReturnType<typeof make>>) =>
  h(new Request('http://localhost/api/v1/x'), { params: Promise.resolve({}) });

describe('[F1.5] every permission is enforced on the server', () => {
  it.each([...PERMISSION_KEYS])('[F1.5] %s: without → 403, with → 200', async (key) => {
    const handler = vi.fn(() => ({ ok: true }));
    const without = { ...base, permissions: new Set([...base.permissions].filter((k) => k !== key)) };
    const denied = await call(make(without)({ auth: 'session', permission: key, handler }));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('FORBIDDEN');
    expect(handler).not.toHaveBeenCalled();
    const allowed = await call(
      make({ ...base, permissions: new Set([key]) })({ auth: 'session', permission: key, handler }),
    );
    expect(allowed.status).toBe(200);
  });
});
