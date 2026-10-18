import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretBox, SecretDecryptError } from './secrets';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');
const AAD = '0192f0e2-0000-7000-8000-000000000001';

function flipChar(s: string, i: number): string {
  const c = s[i] === 'A' ? 'B' : 'A';
  return s.slice(0, i) + c + s.slice(i + 1);
}

describe('[I5.3] secrets AES-256-GCM', () => {
  it('[I5.3] round-trips and never contains the plaintext', () => {
    const box = createSecretBox(k1);
    const env = box.encrypt('EAAG-meta-token-ünïcødé', AAD);
    expect(env).toMatch(/^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+$/);
    expect(env).not.toContain('meta-token');
    expect(box.decrypt(env, AAD)).toBe('EAAG-meta-token-ünïcødé');
  });

  it('[I5.3] uses a fresh IV per encryption', () => {
    const box = createSecretBox(k1);
    expect(box.encrypt('same', AAD)).not.toBe(box.encrypt('same', AAD));
  });

  it('[I5.3] detects tampering of ciphertext or tag', () => {
    const box = createSecretBox(k1);
    const env = box.encrypt('secret', AAD);
    const body = env.split('.')[2]!;
    for (const i of [2, body.length - 2]) {
      const tampered = `${env.split('.').slice(0, 2).join('.')}.${flipChar(body, i)}`;
      expect(() => box.decrypt(tampered, AAD)).toThrow(SecretDecryptError);
    }
  });

  it('[I5.3] binds to the AAD: a ciphertext moved to another row fails', () => {
    const box = createSecretBox(k1);
    const env = box.encrypt('secret', AAD);
    expect(() => box.decrypt(env, 'another-row-id')).toThrow(/authentication failed/);
  });

  it('[I5.3] rejects unknown versions, truncated bodies and unknown keys', () => {
    const box = createSecretBox(k1);
    expect(() => box.decrypt('v2.abcd1234.AAAA', AAD)).toThrow(/unsupported format/);
    expect(() => box.decrypt(`v1.${box.currentKeyId}.AAAA`, AAD)).toThrow(/truncated/);
    const other = createSecretBox(k2).encrypt('x', AAD);
    expect(() => box.decrypt(other, AAD)).toThrow(/unknown key id/);
  });

  it('[I5.3] rotation: previous key still decrypts, and needsReencrypt flags old envelopes', () => {
    const old = createSecretBox(k1).encrypt('rotate-me', AAD);
    const rotated = createSecretBox(k2, [k1]);
    expect(rotated.decrypt(old, AAD)).toBe('rotate-me');
    expect(rotated.needsReencrypt(old)).toBe(true);
    expect(rotated.needsReencrypt(rotated.encrypt('rotate-me', AAD))).toBe(false);
  });
});
