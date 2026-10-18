import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/v1/me', () => {
  it('[F1.1] is 401 without a session (T-101 adds sessions)', async () => {
    const res = await GET(new Request('http://localhost/api/v1/me'), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
