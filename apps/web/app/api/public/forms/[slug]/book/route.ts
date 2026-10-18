// POST /api/public/forms/:slug/book: the customer picks a slot; creates the appointment on the owner's
// calendar and queues the localized WhatsApp confirmation (I3.8, I3.9). Lane C.
import { bookSlot } from '@relay/core/services/instant-booking';
import { z } from 'zod';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'public',
  params: z.object({ slug: z.string().max(80) }),
  body: z.object({ token: z.string().min(10).max(1000), startsAt: z.iso.datetime({ offset: true }) }),
  rateLimit: { name: 'form.book', limit: 10, windowSeconds: 600, by: 'ip' },
  handler: async ({ body }) => {
    const r = await bookSlot(body.token, body.startsAt);
    kickDueWork(); // Google event + WhatsApp confirmation
    return r;
  },
});
