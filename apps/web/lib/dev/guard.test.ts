import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDevTools, devToolsEnabled } from './guard';

afterEach(() => vi.unstubAllEnvs());

describe('dev tools guard', () => {
  it('[Q14] only NODE_ENV=development AND DEMO_MODE enables dev tools', () => {
    expect(devToolsEnabled({ NODE_ENV: 'development', DEMO_MODE: '1' })).toBe(true);
    expect(devToolsEnabled({ NODE_ENV: 'development', DEMO_MODE: 'true' })).toBe(true);
    expect(devToolsEnabled({ NODE_ENV: 'development', DEMO_MODE: '0' })).toBe(false);
    expect(devToolsEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(devToolsEnabled({ NODE_ENV: 'production', DEMO_MODE: '1' })).toBe(false);
    expect(devToolsEnabled({ NODE_ENV: 'test', DEMO_MODE: '1' })).toBe(false);
    expect(() => assertDevTools({ NODE_ENV: 'production', DEMO_MODE: '1' })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('[Q14] GET /api/dev/login-as is 404 outside dev, 200 in dev + DEMO_MODE', async () => {
    const { GET } = await import('@/app/api/dev/login-as/route');
    const call = () => GET(new Request('http://localhost/api/dev/login-as'), { params: Promise.resolve({}) });

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO_MODE', '1');
    expect((await call()).status).toBe(404);

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEMO_MODE', '0');
    expect((await call()).status).toBe(404);

    vi.stubEnv('DEMO_MODE', '1');
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ users: [] });
  });
});
