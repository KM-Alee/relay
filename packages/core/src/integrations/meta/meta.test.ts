import { describe, expect, it } from 'vitest';
import { createMetaAdapter, classifyMetaError, metaSignature } from './adapter';
import { metaInboundPayload, metaStatusPayload, signedMetaRequest } from './fake';

const meta = createMetaAdapter();

describe('meta adapter', () => {
  it('[I1.2] verifies a correct HMAC, rejects tampering, and fails closed without an app secret', () => {
    const req = signedMetaRequest('s3cret', metaInboundPayload({ wamid: 'wamid.A', from: '923001112233' }));
    expect(meta.verifyWebhook(req, { appSecret: 's3cret' })).toEqual({ ok: true });
    expect(meta.verifyWebhook({ ...req, rawBody: req.rawBody + ' ' }, { appSecret: 's3cret' })).toMatchObject(
      { ok: false },
    );
    expect(meta.verifyWebhook(req, {})).toEqual({ ok: false, reason: 'app_secret_missing' });
    expect(meta.verifyWebhook({ ...req, headers: new Headers() }, { appSecret: 's3cret' })).toMatchObject({
      reason: 'missing_signature',
    });
    expect(metaSignature('s3cret', 'x')).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('[I1.5] parses inbound text/media and statuses (one body, many events)', () => {
    const inbound = metaInboundPayload({
      wamid: 'wamid.B',
      from: '923001112233',
      type: 'image',
      mediaId: 'M9',
      text: 'pic',
    });
    const [e] = meta.parseWebhook(signedMetaRequest('k', inbound));
    expect(e).toMatchObject({
      type: 'inbound',
      from: '+923001112233',
      kind: 'image',
      providerMediaId: 'M9',
      text: 'pic',
    });
    const [s] = meta.parseWebhook(
      signedMetaRequest(
        'k',
        metaStatusPayload({
          wamid: 'wamid.C',
          status: 'failed',
          to: '1',
          error: { code: 131030, title: 'not allowed' },
        }),
      ),
    );
    expect(s).toMatchObject({
      type: 'status',
      status: 'failed',
      externalEventId: 'wamid.C:failed',
      errorCode: '131030',
    });
  });

  it('[I1.7] classifies provider errors into retry classes with plain reasons', () => {
    expect(classifyMetaError(131030)).toEqual({ kind: 'permanent', reason: 'recipient_not_allowed' });
    expect(classifyMetaError(131047)).toEqual({ kind: 'permanent', reason: 'window_closed' });
    expect(classifyMetaError(190)).toEqual({ kind: 'auth', reason: 'token_expired' });
    expect(classifyMetaError(undefined, 503).kind).toBe('temporary');
    expect(classifyMetaError(130429).kind).toBe('temporary');
  });
});
