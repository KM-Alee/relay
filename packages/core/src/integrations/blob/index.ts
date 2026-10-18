// Media storage (I1.11, T-142; docs/04 §9). Vercel Blob in PRIVATE mode (@vercel/blob 2.x `access: 'private'`),
// pathname ws/<workspaceId>/<uuid>. Keys are never sent to the browser: bytes are served by the authed
// proxy /api/v1/media/:id. Without BLOB_READ_WRITE_TOKEN (or if the store rejects private puts) the
// bytes go to Postgres (`media.data`, size-capped) so the demo still works.
import { randomUUID } from 'node:crypto';
import { config } from '../../config';

/** Postgres fallback cap. WhatsApp allows up to 16 MB; beyond the cap we refuse rather than bloat the DB. */
export const MAX_DB_MEDIA_BYTES = 8 * 1024 * 1024;

export type StoredBlob = { blobKey: string } | { data: Buffer };

export const blobConfigured = (): boolean => !!config.storage.BLOB_READ_WRITE_TOKEN;

export async function putMedia(workspaceId: string, bytes: Uint8Array, mime: string): Promise<StoredBlob> {
  const token = config.storage.BLOB_READ_WRITE_TOKEN;
  if (token) {
    try {
      const { put } = await import('@vercel/blob');
      const key = `ws/${workspaceId}/${randomUUID()}`;
      await put(key, Buffer.from(bytes), {
        access: 'private',
        token,
        contentType: mime,
        addRandomSuffix: false,
      });
      return { blobKey: key };
    } catch {
      /* store missing/misconfigured: fall through to the DB fallback */
    }
  }
  if (bytes.byteLength > MAX_DB_MEDIA_BYTES) throw new Error('media_too_large_for_fallback');
  return { data: Buffer.from(bytes) };
}

export async function getMediaStream(blobKey: string): Promise<ReadableStream<Uint8Array> | null> {
  const token = config.storage.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const { get } = await import('@vercel/blob');
  const r = await get(blobKey, { access: 'private', token });
  return r && r.statusCode === 200 ? r.stream : null;
}
