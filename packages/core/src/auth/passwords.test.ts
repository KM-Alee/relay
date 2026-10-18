import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../ids';
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from './passwords';
import {
  clearSessionCookieHeader,
  hashSessionToken,
  newSessionToken,
  sessionCookieHeader,
  sessionCookieName,
} from './sessions';

describe('[Q1] passwords', () => {
  it('[Q1] argon2id round-trip with OWASP params; wrong password and malformed hash fail', async () => {
    const h = await hashPassword('a long passphrase');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(h, 'a long passphrase')).toBe(true);
    expect(await verifyPassword(h, 'a long passphrasE')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash(h.replace('m=19456', 'm=4096'))).toBe(true);
    expect(needsRehash('$2b$10$bcrypt')).toBe(true);
  });

  it('[Q1] policy: ≥ 10 characters, not a common password, no composition rules', () => {
    expect(passwordProblem('short')).toBe('too_short');
    expect(passwordProblem('1234567890')).toBe('too_common');
    expect(passwordProblem('QwertyUIOP')).toBe('too_common');
    expect(passwordProblem('ریلے کا پاس ورڈ')).toBeNull(); // unicode counted by code point
    expect(passwordProblem('correct horse battery')).toBeNull();
  });
});

describe('[Q1] session tokens + cookie', () => {
  it('[Q1] 32 random bytes base64url; DB hash is sha256 of the raw bytes; malformed tokens hash to null', () => {
    const { token, hash } = newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toHaveLength(32);
    expect(hashSessionToken(token)!.equals(hash)).toBe(true);
    expect(newSessionToken().token).not.toBe(token);
    for (const bad of [undefined, null, '', 'x', `${token}=`, token.slice(1), 'a'.repeat(44)])
      expect(hashSessionToken(bad)).toBeNull();
  });

  it('[Q1] cookie is HttpOnly + SameSite=Lax + Path=/, Secure + __Host- prefix in production', () => {
    const dev = sessionCookieHeader('tok', false);
    expect(dev).toBe('sid=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
    const prod = sessionCookieHeader('tok', true);
    expect(prod).toMatch(/^__Host-sid=tok; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    expect(prod).not.toMatch(/Domain=/i);
    expect(sessionCookieName(true)).toBe('__Host-sid');
    expect(clearSessionCookieHeader(false)).toMatch(/^sid=; .*Max-Age=0/);
  });
});

describe('ids', () => {
  it('[Q14] uuidv7 is a valid, time-ordered v7 UUID', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
