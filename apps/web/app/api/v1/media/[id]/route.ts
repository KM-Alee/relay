// GET /api/v1/media/:id: authed media proxy (I1.6, I1.11). Re-checks session + workspace + conversation
// visibility on EVERY request; blob keys never reach the browser. `Cache-Control: private`.
import { notFound } from '@relay/core/errors';
import { getMediaStream } from '@relay/core/integrations/blob';
import { messagingService } from '@relay/core/services/messaging';
import { z } from 'zod';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

// Only types the browser can render inertly inline; everything else downloads.
const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|amr|webm)|application\/pdf)$/;

export const GET = route({
  auth: 'session',
  permission: 'crm.contact.view',
  params: z.object({ id: z.uuid() }),
  handler: async ({ actor, params }) => {
    const m = await messagingService.getMedia(actor, params.id);
    const body: BodyInit | null = m.data
      ? new Uint8Array(m.data)
      : m.blobKey
        ? await getMediaStream(m.blobKey)
        : null;
    if (!body) throw notFound();
    const base = m.mime.split(';')[0]!.trim().toLowerCase();
    const name = (m.filename ?? 'file').replace(/[^\w.-]+/g, '_');
    const inline = INLINE.test(base);
    return new Response(body, {
      headers: {
        'content-type': inline ? base : 'application/octet-stream',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, max-age=300',
      },
    });
  },
});
