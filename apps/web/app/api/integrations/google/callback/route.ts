// GET /api/integrations/google/callback: OAuth redirect target (I3.1, 04 §2). Validates the single-use state for the
// signed-in user, exchanges the code, stores encrypted tokens, then returns the user to the Appointments page.
import { calendarService } from '@relay/core/services/calendar';
import { log } from '@relay/core/log';
import { z } from 'zod';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'appointments.manage',
  query: z.object({
    code: z.string().max(2048).optional(),
    state: z.string().max(256).optional(),
    error: z.string().max(100).optional(),
  }),
  handler: async ({ actor, query }) => {
    let outcome = 'connected';
    try {
      await calendarService.completeConnect(actor, query);
    } catch (err) {
      const reason = (err as { details?: { reason?: string } }).details?.reason;
      log.warn('google.callback_failed', { reason, err });
      outcome = reason === 'consent_denied' ? 'denied' : 'error';
    }
    return new Response(null, {
      status: 302,
      headers: { location: `/${actor.locale}/appointments?calendar=${outcome}` },
    });
  },
});
