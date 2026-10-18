// POST /api/public/forms/:slug: public web form submit (F3.1). No session; CSRF-exempt prefix.
// Spam: honeypot (`website`) + per-IP rate limit; server-side Zod validation. Same answer whatever the
// routing outcome (03 T1 step 6). Lane A.
import { publicFormParams, publicFormSubmit } from '@relay/contracts/api/leads';
import { offerBooking } from '@relay/core/services/instant-booking';
import { leadsService } from '@relay/core/services/leads';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'public',
  params: publicFormParams,
  body: publicFormSubmit,
  rateLimit: { name: 'form', limit: 10, windowSeconds: 600, by: 'ip' },
  handler: async ({ params, body }) => {
    const r = await leadsService.submitPublicForm(params.slug, body);
    kickDueWork();
    // I3.8 (Lane C): offer the owner's free slots when their calendar is connected. Honeypot hits get nothing.
    if (body.website) return r;
    const offer = await offerBooking(params.slug, body);
    return offer.bookingAvailable ? { ...r, ...offer } : r;
  },
});
