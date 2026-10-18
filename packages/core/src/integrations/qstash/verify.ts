// Upstash-Signature verification with the official Receiver (06 §7): current + next signing keys,
// issuer "Upstash", URL-bound (`sub`), body hash over the RAW body, nbf/exp checked.
import { Receiver } from '@upstash/qstash';
import type { TickVerifier } from './types';

export interface QStashVerifierConfig {
  currentSigningKey: string;
  nextSigningKey: string;
  /** Seconds of nbf/exp tolerance for clock skew between QStash and us. */
  clockToleranceSeconds?: number;
}

export function createQStashVerifier(cfg: QStashVerifierConfig): TickVerifier {
  // devMode:false → never fall back to the local QStash dev-server keys via QSTASH_DEV.
  const receiver = new Receiver({
    currentSigningKey: cfg.currentSigningKey,
    nextSigningKey: cfg.nextSigningKey,
    devMode: false,
  });
  return {
    async verify({ signature, body, url }) {
      if (!signature) return false;
      try {
        return await receiver.verify({
          signature,
          body,
          url,
          clockTolerance: cfg.clockToleranceSeconds ?? 5,
        });
      } catch {
        return false; // SignatureError (bad key / body / url / expired) → 401, never a 500
      }
    },
  };
}
