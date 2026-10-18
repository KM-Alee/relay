import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, redact } from './log';

afterEach(() => vi.restoreAllMocks());

describe('redacting logger', () => {
  it('[Q13] redacts secrets, tokens, cookies and provider signatures at any depth', () => {
    const out = redact({
      path: '/api/x',
      headers: {
        Authorization: 'Bearer abc',
        cookie: 'sid=1',
        'x-hub-signature-256': 'sha256=…',
        'x-slack-signature': 'v0=…',
        'stripe-signature': 't=1',
      },
      nested: { deep: { apiKey: 'k', password: 'p', ok: 1 } },
      list: [{ access_token: 't' }],
    }) as Record<string, Record<string, unknown>>;
    expect(JSON.stringify(out)).not.toMatch(/Bearer|sid=1|sha256|v0=|t=1|"k"|"p"|"t"/);
    expect(out.path).toBe('/api/x');
    expect((out.nested as { deep: { ok: number } }).deep.ok).toBe(1);
  });

  it('[Q13] redacts Headers objects and reduces errors to name + message', () => {
    const h = new Headers({ authorization: 'x', 'content-type': 'application/json' });
    expect(redact({ h })).toEqual({ h: { authorization: '[redacted]', 'content-type': 'application/json' } });
    expect(redact({ err: new TypeError('boom') })).toEqual({ err: { name: 'TypeError', message: 'boom' } });
  });

  it('[Q13] writes one JSON line without the secret', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    log.error('failed', { token: 'secret-value', path: '/a' });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).not.toContain('secret-value');
    expect(JSON.parse(line)).toMatchObject({ level: 'error', msg: 'failed', path: '/a' });
  });
});
