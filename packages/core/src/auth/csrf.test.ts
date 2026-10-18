import { describe, expect, it } from 'vitest';
import { createCsrfToken, isCsrfExempt, isValidCsrfToken, verifyCsrf, type CsrfInput } from './csrf';

const SECRET = 'test-secret-test-secret-test-secret';
const token = createCsrfToken(SECRET);
const ok: CsrfInput = {
  method: 'POST',
  pathname: '/api/v1/leads',
  origin: 'http://localhost:3000',
  referer: null,
  host: 'localhost:3000',
  cookieToken: token,
  headerToken: token,
  trustedOrigins: ['https://relay.example.com'],
  secret: SECRET,
};

describe('[F1.5][Q3] CSRF', () => {
  it('[F1.5] accepts a same-origin request with matching signed tokens', () => {
    expect(verifyCsrf(ok)).toEqual({ ok: true });
  });

  it('[F1.5] safe methods are never checked', () => {
    expect(
      verifyCsrf({ ...ok, method: 'GET', origin: null, cookieToken: undefined, headerToken: null }),
    ).toEqual({ ok: true });
  });

  it('[F1.5] rejects missing / foreign origin; falls back to Referer; trusts PUBLIC_BASE_URL', () => {
    expect(verifyCsrf({ ...ok, origin: null })).toEqual({ ok: false, reason: 'origin_missing' });
    expect(verifyCsrf({ ...ok, origin: 'null' })).toEqual({ ok: false, reason: 'origin_missing' });
    expect(verifyCsrf({ ...ok, origin: 'https://evil.example' })).toEqual({
      ok: false,
      reason: 'origin_mismatch',
    });
    expect(verifyCsrf({ ...ok, origin: null, referer: 'http://localhost:3000/en/leads' })).toEqual({
      ok: true,
    });
    expect(verifyCsrf({ ...ok, origin: 'https://relay.example.com', host: 'internal:3000' })).toEqual({
      ok: true,
    });
  });

  it('[F1.5] rejects missing, mismatched or forged tokens', () => {
    expect(verifyCsrf({ ...ok, headerToken: null })).toEqual({ ok: false, reason: 'token_missing' });
    expect(verifyCsrf({ ...ok, headerToken: createCsrfToken(SECRET) })).toEqual({
      ok: false,
      reason: 'token_mismatch',
    });
    const forged = createCsrfToken('attacker-secret');
    expect(verifyCsrf({ ...ok, cookieToken: forged, headerToken: forged })).toEqual({
      ok: false,
      reason: 'token_invalid',
    });
    expect(isValidCsrfToken(SECRET, 'no-dot')).toBe(false);
  });

  it('[F1.5][I1.2] webhooks (incl. Slack), internal and public routes are exempt', () => {
    for (const p of [
      '/api/webhooks/meta/k1',
      '/api/webhooks/slack/events',
      '/api/internal/tick',
      '/api/public/forms/x',
    ]) {
      expect(isCsrfExempt(p)).toBe(true);
      expect(verifyCsrf({ ...ok, pathname: p, origin: null, headerToken: null })).toEqual({ ok: true });
    }
    expect(isCsrfExempt('/api/v1/webhooks-settings')).toBe(false);
    expect(isCsrfExempt('/api/webhooksx')).toBe(false);
  });
});
