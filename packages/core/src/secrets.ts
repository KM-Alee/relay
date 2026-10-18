// Secret encryption for per-workspace provider credentials (docs/06-security.md §5, I5.3).
//
// AES-256-GCM envelope, versioned, as a compact string:
//     v1.<keyId>.<base64url( iv(12) | ciphertext | tag(16) )>
// - keyId = first 8 hex chars of sha256(key): identifies which key encrypted it, so rotation can
//   decrypt with APP_ENCRYPTION_KEY_PREVIOUS while new writes use APP_ENCRYPTION_KEY.
// - AAD = the owning row id (e.g. integration_connections.id), so ciphertexts can't be swapped
//   between rows. Pass the same `aad` to decrypt.
// Decrypted values exist only inside adapter calls. Never log or return them.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretDecryptError extends Error {
  constructor(reason: string) {
    super(`Secret could not be decrypted: ${reason}`);
    this.name = 'SecretDecryptError';
  }
}

export interface SecretBox {
  encrypt(plaintext: string, aad: string): string;
  decrypt(envelope: string, aad: string): string;
  /** True when the envelope was written with a non-current key (re-encrypt during rotation). */
  needsReencrypt(envelope: string): boolean;
  readonly currentKeyId: string;
}

const keyIdOf = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 8);

function decodeKey(b64: string, name: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes (base64)`);
  return key;
}

/** Build a box from base64 keys: the first is current; the rest are accepted for decryption only. */
export function createSecretBox(currentKeyB64: string, previousKeysB64: string[] = []): SecretBox {
  const current = decodeKey(currentKeyB64, 'current key');
  const currentKeyId = keyIdOf(current);
  const keys = new Map<string, Buffer>([[currentKeyId, current]]);
  for (const b64 of previousKeysB64) {
    const k = decodeKey(b64, 'previous key');
    keys.set(keyIdOf(k), k);
  }

  function parse(envelope: string): { keyId: string; iv: Buffer; ct: Buffer; tag: Buffer } {
    const parts = envelope.split('.');
    if (parts.length !== 3 || parts[0] !== VERSION) throw new SecretDecryptError('unsupported format');
    const [, keyId, body] = parts as [string, string, string];
    const raw = Buffer.from(body, 'base64url');
    if (raw.length < IV_BYTES + TAG_BYTES) throw new SecretDecryptError('truncated');
    return {
      keyId,
      iv: raw.subarray(0, IV_BYTES),
      ct: raw.subarray(IV_BYTES, raw.length - TAG_BYTES),
      tag: raw.subarray(raw.length - TAG_BYTES),
    };
  }

  return {
    currentKeyId,
    encrypt(plaintext, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', current, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const body = Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64url');
      return `${VERSION}.${currentKeyId}.${body}`;
    },
    decrypt(envelope, aad) {
      const { keyId, iv, ct, tag } = parse(envelope);
      const key = keys.get(keyId);
      if (!key) throw new SecretDecryptError('unknown key id');
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      } catch {
        // Tampered ciphertext/tag, wrong AAD or wrong key. Never say which.
        throw new SecretDecryptError('authentication failed');
      }
    },
    needsReencrypt(envelope) {
      return parse(envelope).keyId !== currentKeyId;
    },
  };
}

let box: SecretBox | undefined;
function defaultBox(): SecretBox {
  if (!box) {
    const { APP_ENCRYPTION_KEY, APP_ENCRYPTION_KEY_PREVIOUS } = config.core;
    box = createSecretBox(
      APP_ENCRYPTION_KEY,
      APP_ENCRYPTION_KEY_PREVIOUS ? [APP_ENCRYPTION_KEY_PREVIOUS] : [],
    );
  }
  return box;
}

/** Process-wide secrets API using APP_ENCRYPTION_KEY (+ _PREVIOUS for rotation). */
export const secrets = {
  encrypt: (plaintext: string, aad: string) => defaultBox().encrypt(plaintext, aad),
  decrypt: (envelope: string, aad: string) => defaultBox().decrypt(envelope, aad),
  needsReencrypt: (envelope: string) => defaultBox().needsReencrypt(envelope),
};
