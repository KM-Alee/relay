// Test-only: mint an Upstash-Signature JWT exactly like QStash does (HS256 over the signing key,
// iss "Upstash", sub = destination URL, body = base64url(sha256(raw body))). Lets the verifier be
// tested byte-for-byte without network access (04 §11 "real signature fixtures").
import { createHash, createHmac, randomUUID } from 'node:crypto';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface SignOptions {
  key: string;
  url: string;
  body: string;
  /** Seconds relative to now. */
  expiresIn?: number;
  notBeforeIn?: number;
  issuer?: string;
}

export function signQStashRequest(o: SignOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: o.issuer ?? 'Upstash',
      sub: o.url,
      exp: now + (o.expiresIn ?? 300),
      nbf: now + (o.notBeforeIn ?? 0),
      iat: now,
      jti: randomUUID(),
      body: createHash('sha256').update(o.body).digest('base64url'),
    }),
  );
  const sig = createHmac('sha256', o.key).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
