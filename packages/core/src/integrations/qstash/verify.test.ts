import { describe, expect, it } from 'vitest';
import { signQStashRequest } from './test-signing';
import { createQStashVerifier } from './verify';

const CURRENT = 'sig_current_test_key_0123456789';
const NEXT = 'sig_next_test_key_9876543210';
const URL_ = 'https://relay.example.com/api/internal/tick';
const BODY = '{"trigger":"qstash","at":"2026-10-18T10:00:05.000Z"}';

const verifier = createQStashVerifier({ currentSigningKey: CURRENT, nextSigningKey: NEXT });

describe('[Q5] QStash signature verification (Upstash-Signature, raw body, URL-bound)', () => {
  it('[Q5] accepts a request signed with the current key', async () => {
    const signature = signQStashRequest({ key: CURRENT, url: URL_, body: BODY });
    expect(await verifier.verify({ signature, body: BODY, url: URL_ })).toBe(true);
  });

  it('[Q5] accepts the next key (key rotation)', async () => {
    const signature = signQStashRequest({ key: NEXT, url: URL_, body: BODY });
    expect(await verifier.verify({ signature, body: BODY, url: URL_ })).toBe(true);
  });

  it.each([
    ['a wrong key', { key: 'attacker' }, {}],
    ['a tampered body (one byte)', {}, { body: BODY.replace('05', '06') }],
    ['re-serialized JSON (raw body matters)', {}, { body: JSON.stringify(JSON.parse(BODY), null, 1) }],
    [
      'another URL (replay to a different deployment)',
      {},
      { url: 'https://evil.example.com/api/internal/tick' },
    ],
    ['an expired token', { expiresIn: -60 }, {}],
    ['a token not valid yet', { notBeforeIn: 120 }, {}],
    ['a wrong issuer', { issuer: 'NotUpstash' }, {}],
  ])('[Q5] rejects %s', async (_n, sign, req) => {
    const signature = signQStashRequest({ key: CURRENT, url: URL_, body: BODY, ...sign });
    expect(await verifier.verify({ signature, body: BODY, url: URL_, ...req })).toBe(false);
  });

  it('[Q5] rejects garbage and an empty signature without throwing', async () => {
    expect(await verifier.verify({ signature: 'not.a.jwt', body: BODY, url: URL_ })).toBe(false);
    expect(await verifier.verify({ signature: '', body: BODY, url: URL_ })).toBe(false);
  });
});
