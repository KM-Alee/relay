// GET /api/public/forms/:slug/slots?token=...: free slots of the assigned owner after a form submit (I3.8).
// No session; the signed, short-lived token minted by the submit is the credential. Lane C.
import { listSlots } from '@relay/core/services/instant-booking';
import { z } from 'zod';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'public',
  params: z.object({ slug: z.string().max(80) }),
  query: z.object({ token: z.string().min(10).max(1000) }),
  rateLimit: { name: 'form.slots', limit: 30, windowSeconds: 600, by: 'ip' },
  handler: ({ query }) => listSlots(query.token),
});
