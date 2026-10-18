import { ERROR_CATALOGUE, ERROR_CODES } from '@relay/contracts/errors';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en/errors.json';
import ur from '../../messages/ur/errors.json';
import { localizeError, readApiError, toApiError } from './client-error';

describe('[Q10][F7.1] localized errors', () => {
  it('[F7.1][Q10] every error code has an en and ur message', () => {
    for (const code of ERROR_CODES) {
      const key = ERROR_CATALOGUE[code].i18nKey.replace(/^errors\./, '');
      expect(en, `en missing ${key}`).toHaveProperty(key);
      expect(ur, `ur missing ${key}`).toHaveProperty(key);
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(ur).sort());
  });

  it('[Q10] reads the envelope and renders through t(key, details)', async () => {
    const res = Response.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'x',
          i18nKey: 'errors.rateLimited',
          details: { retryAfter: 30 },
        },
      },
      { status: 429 },
    );
    const err = await readApiError(res);
    expect(err).toMatchObject({ code: 'RATE_LIMITED', status: 429, i18nKey: 'errors.rateLimited' });
    const t = (key: string, v?: Record<string, unknown>) => `${key}:${JSON.stringify(v)}`;
    expect(localizeError(err, t)).toBe('errors.rateLimited:{"retryAfter":30}');
  });

  it('[Q10] non-JSON / unknown codes / network failures degrade gracefully', async () => {
    expect((await readApiError(new Response('<html>bad gateway</html>', { status: 502 }))).code).toBe(
      'INTERNAL',
    );
    const unknown = Response.json(
      { error: { code: 'FUTURE_CODE', message: 'x', i18nKey: 'errors.future' } },
      { status: 404 },
    );
    expect((await readApiError(unknown)).code).toBe('NOT_FOUND');
    expect(toApiError(new TypeError('fetch failed')).i18nKey).toBe('errors.networkError');
  });
});
