import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/v1/changes', () => {
  it('[Q11][F1.1] is 401 without a session', async () => {
    const res = await GET(new Request('http://localhost/api/v1/changes?since=2026-10-18T10:00:00Z'), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });
});
