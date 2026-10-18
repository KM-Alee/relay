// IDs: UUID v7 generated in app (docs/10-conventions.md §1, docs/02-data-model.md). Time-ordered, so
// keyset pagination by id follows creation order. Added by Lane B (T-101); shared helper.
import { randomBytes } from 'node:crypto';

/** RFC 9562 UUID version 7: 48-bit unix ms timestamp + 74 random bits. */
export function uuidv7(nowMs: number = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(nowMs, 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
