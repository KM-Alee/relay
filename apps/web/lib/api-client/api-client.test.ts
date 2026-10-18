import { endpoint } from '@relay/contracts/api/endpoint';
import { buildMe } from '@relay/contracts/fixtures/users';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildPath, call } from './http';
import { api } from './index';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api-client', () => {
  it('[Q14] fixture mode: api.users.me() returns the fixture without touching the network', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_FIXTURES', '1');
    const fetchImpl = vi.fn();
    await expect(api.users.me({ fetchImpl })).resolves.toEqual(buildMe());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('[Q14] fixture mode is ignored in production builds', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_FIXTURES', '1');
    vi.stubEnv('NODE_ENV', 'production');
    const fetchImpl = vi.fn(async () => json(buildMe()));
    await api.users.me({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('[Q10] network mode: parses the response, maps error envelopes to ApiError', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_FIXTURES', '0');
    const ok = vi.fn(async () => json(buildMe()));
    await expect(api.users.me({ fetchImpl: ok })).resolves.toMatchObject({ user: { baseLevel: 'owner' } });
    expect(ok).toHaveBeenCalledWith('/api/v1/me', expect.objectContaining({ method: 'GET' }));

    const unauth = vi.fn(async () =>
      json({ error: { code: 'UNAUTHENTICATED', message: 'x', i18nKey: 'errors.unauthenticated' } }, 401),
    );
    await expect(api.users.me({ fetchImpl: unauth })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
      i18nKey: 'errors.unauthenticated',
    });
  });

  it('[Q3] mutations send x-csrf-token from the csrf cookie, and JSON bodies', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_FIXTURES', '0');
    vi.stubGlobal('document', { cookie: 'other=1; csrf=abc.def' });
    const ep = endpoint({
      method: 'POST',
      path: '/api/v1/things/:id/act',
      params: z.object({ id: z.string() }),
      body: z.object({ n: z.number() }),
      response: z.object({ ok: z.boolean() }),
    });
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    await call('crm', ep, { params: { id: 'a b' }, body: { n: 1 } }, () => ({ ok: false }), { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/things/a%20b/act',
      expect.objectContaining({
        method: 'POST',
        body: '{"n":1}',
        headers: expect.objectContaining({ 'x-csrf-token': 'abc.def', 'content-type': 'application/json' }),
      }),
    );
  });

  it('[Q14] buildPath fills params and drops empty query values', () => {
    expect(buildPath('/api/v1/leads/:id', { id: '1' }, { view: 'all', cursor: undefined })).toBe(
      '/api/v1/leads/1?view=all',
    );
    expect(() => buildPath('/api/v1/leads/:id')).toThrow(/missing path param/);
  });

  it('[Q14] fixtures are validated against the contract', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_FIXTURES', '1');
    const ep = endpoint({ method: 'GET', path: '/api/v1/x', response: z.object({ n: z.number() }) });
    await expect(call('crm', ep, {}, () => ({ n: 'bad' }) as unknown as { n: number })).rejects.toThrow();
  });
});
