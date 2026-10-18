import type { Actor } from '@relay/core/auth/actor';
import { createCsrfToken } from '@relay/core/auth/csrf';
import { AppError } from '@relay/core/errors';
import type { RateLimiter } from '@relay/core/services/rate-limit';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createRoute, type RouteDeps } from './route';

const SECRET = 'route-test-secret-route-test-secret';
const BASE = 'http://localhost:3000';
const actor: Actor = {
  userId: '0192f0e2-0000-7000-8000-0000000000a1',
  workspaceId: '0192f0e2-0000-7000-8000-0000000000b1',
  sessionId: 's1',
  baseLevel: 'user',
  permissions: new Set(['leads.create']),
  locale: 'en',
};

function setup(over: Partial<RouteDeps> = {}) {
  const deps: RouteDeps = {
    resolveActor: async () => actor,
    rateLimiter: async (r) => ({ allowed: true, count: 1, limit: r.limit, retryAfterSeconds: 60 }),
    csrfSecret: () => SECRET,
    trustedOrigins: () => [BASE],
    secureCookies: () => false,
    logError: vi.fn(),
    ...over,
  };
  return { route: createRoute(deps), deps };
}

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const token = createCsrfToken(SECRET);

function post(
  path: string,
  body: unknown,
  opts: { csrf?: boolean; origin?: string | null; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: 'localhost:3000',
    ...opts.headers,
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? BASE;
  if (opts.csrf !== false) {
    headers.cookie = `csrf=${token}`;
    headers['x-csrf-token'] = token;
  }
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const input = z.object({ name: z.string().min(1) }).strict();

describe('[Q3][Q10] route() wrapper', () => {
  it('[Q3] session → actor → Zod → handler → JSON', async () => {
    const { route } = setup();
    const handler = vi.fn(async ({ actor: a, body }: { actor: Actor; body: { name: string } }) => ({
      by: a.userId,
      name: body.name,
    }));
    const POST = route({ auth: 'session', permission: 'leads.create', body: input, status: 201, handler });
    const res = await POST(post('/api/v1/leads', { name: 'Ali' }), ctx());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ by: actor.userId, name: 'Ali' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('[F1.5] a POST without CSRF token gets 403 CSRF_FAILED and never reaches the handler', async () => {
    const { route } = setup();
    const handler = vi.fn(async () => ({}));
    const POST = route({ auth: 'session', body: input, handler });
    const res = await POST(post('/api/v1/leads', { name: 'x' }, { csrf: false }), ctx());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'CSRF_FAILED', message: expect.any(String), i18nKey: 'errors.csrfFailed' },
    });
    expect(handler).not.toHaveBeenCalled();
    // The response hands the client a token for its next try.
    expect(res.headers.get('set-cookie')).toMatch(/^csrf=[^;]+; Path=\/; SameSite=Lax/);
  });

  it('[F1.5] a cross-origin POST is rejected even with tokens', async () => {
    const { route } = setup();
    const POST = route({ auth: 'session', handler: async () => ({}) });
    const res = await POST(post('/api/v1/leads', {}, { origin: 'https://evil.example' }), ctx());
    expect(res.status).toBe(403);
  });

  it('[F1.5][I1.2] webhook paths (incl. Slack) are exempt from CSRF', async () => {
    const { route } = setup({ resolveActor: async () => null });
    const POST = route({ auth: 'public', handler: async () => ({ ok: true }) });
    const res = await POST(post('/api/webhooks/slack/events', {}, { csrf: false, origin: null }), ctx());
    expect(res.status).toBe(200);
  });

  it('[F1.5] no session → 401; missing permission → 403', async () => {
    const anon = setup({ resolveActor: async () => null }).route({
      auth: 'session',
      handler: async () => ({}),
    });
    expect((await anon(post('/api/v1/x', {}), ctx())).status).toBe(401);
    const noPerm = setup().route({ auth: 'session', permission: 'users.manage', handler: async () => ({}) });
    const res = await noPerm(post('/api/v1/x', {}), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('[Q3] invalid body → 400 with paths/codes only; unknown keys rejected; bad JSON and wrong type handled', async () => {
    const POST = setup().route({ auth: 'session', body: input, handler: async () => ({}) });
    const bad = await POST(post('/api/v1/x', { name: '', workspaceId: 'evil' }), ctx());
    expect(bad.status).toBe(400);
    const j = await bad.json();
    expect(j.error.code).toBe('VALIDATION_FAILED');
    expect(j.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name' }),
        expect.objectContaining({ code: 'unrecognized_keys' }),
      ]),
    );
    expect(JSON.stringify(j)).not.toContain('evil');
    expect((await POST(post('/api/v1/x', '{not json'), ctx())).status).toBe(400);
    expect(
      (await POST(post('/api/v1/x', { name: 'a' }, { headers: { 'content-type': 'text/plain' } }), ctx()))
        .status,
    ).toBe(415);
  });

  it('[Q3] params and query are Zod-parsed', async () => {
    const GET = setup().route({
      auth: 'session',
      params: z.object({ id: z.uuid() }),
      query: z.object({ limit: z.coerce.number().int().max(100).default(20) }),
      handler: async ({ params, query }) => ({ id: params.id, limit: query.limit }),
    });
    const id = '0192f0e2-0000-7000-8000-0000000000c1';
    const ok = await GET(new Request(`${BASE}/api/v1/leads/${id}?limit=5`), ctx({ id }));
    expect(await ok.json()).toEqual({ id, limit: 5 });
    expect((await GET(new Request(`${BASE}/api/v1/leads/nope`), ctx({ id: 'nope' }))).status).toBe(400);
  });

  it('[Q10] AppError from a service maps to its status + envelope with details', async () => {
    const GET = setup().route({
      auth: 'session',
      handler: async () => {
        throw new AppError('STALE_VERSION', { details: { current: 4 } });
      },
    });
    const res = await GET(new Request(`${BASE}/api/v1/x`), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: 'STALE_VERSION',
        message: expect.any(String),
        i18nKey: 'errors.staleVersion',
        details: { current: 4 },
      },
    });
  });

  it('[Q10] unknown errors → generic 500 without leaking internals; logged server-side', async () => {
    const { route, deps } = setup();
    const GET = route({
      auth: 'session',
      handler: async () => {
        throw new Error('duplicate key value violates unique constraint "users_email_key" password=hunter2');
      },
    });
    const res = await GET(new Request(`${BASE}/api/v1/x`), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/users_email_key|hunter2|at .*\.ts/);
    expect(JSON.parse(text).error.code).toBe('INTERNAL');
    expect(deps.logError).toHaveBeenCalledOnce();
  });

  it('[Q1] rate limit → 429 RATE_LIMITED + Retry-After; keyed by user or ip', async () => {
    const limiter = vi.fn<RateLimiter>(async (r) => ({
      allowed: false,
      count: 7,
      limit: r.limit,
      retryAfterSeconds: 42,
    }));
    const route = setup({ rateLimiter: limiter }).route;
    const POST = route({
      auth: 'session',
      rateLimit: { name: 'nudge', limit: 6, windowSeconds: 60, by: 'user' },
      handler: async () => ({}),
    });
    const res = await POST(post('/api/v1/tick-nudge', {}), ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect((await res.json()).error.details).toEqual({ retryAfter: 42 });
    expect(limiter).toHaveBeenCalledWith({ key: `nudge:user:${actor.userId}`, limit: 6, windowSeconds: 60 });

    const pub = setup({ rateLimiter: limiter, resolveActor: async () => null }).route({
      auth: 'public',
      rateLimit: { name: 'login', limit: 20, windowSeconds: 900, by: 'ip' },
      handler: async () => ({}),
    });
    await pub(
      post('/api/v1/auth/login', {}, { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }),
      ctx(),
    );
    expect(limiter).toHaveBeenLastCalledWith({ key: 'login:ip:203.0.113.9', limit: 20, windowSeconds: 900 });
  });

  it('[Q3] a handler may return a raw Response (e.g. CSV stream)', async () => {
    const GET = setup().route({
      auth: 'session',
      handler: async () => new Response('a,b\n', { headers: { 'content-type': 'text/csv' } }),
    });
    const res = await GET(new Request(`${BASE}/api/v1/exports/x`), ctx());
    expect(res.headers.get('content-type')).toBe('text/csv');
    expect(await res.text()).toBe('a,b\n');
  });

  it('[F1.5] a valid csrf cookie is not re-issued', async () => {
    const GET = setup().route({ auth: 'session', handler: async () => ({}) });
    const res = await GET(new Request(`${BASE}/api/v1/me`, { headers: { cookie: `csrf=${token}` } }), ctx());
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
