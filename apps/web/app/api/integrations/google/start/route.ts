// GET /api/integrations/google/start: begin the per-employee Google OAuth consent (I3.1). Session required; the
// state + PKCE verifier are stored server-side (oauth_states), then we 302 to Google.
import { calendarService } from '@relay/core/services/calendar';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'appointments.manage',
  rateLimit: { name: 'google.start', limit: 10, windowSeconds: 60, by: 'user' },
  handler: async ({ actor }) => {
    try {
      const url = await calendarService.startConnect(actor);
      return new Response(null, { status: 302, headers: { location: url } });
    } catch {
      return new Response(null, {
        status: 302,
        headers: { location: `/${actor.locale}/appointments?calendar=unavailable` },
      });
    }
  },
});
