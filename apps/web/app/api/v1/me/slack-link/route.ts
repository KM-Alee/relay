// /api/v1/me/slack-link: "Connect Slack" from the profile (I4.3). Own account only: session, no extra permission.
import { slackService } from '@relay/core/services/slack';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session', handler: ({ actor }) => slackService.linkStatus(actor) });

export const POST = route({
  auth: 'session',
  rateLimit: { name: 'slack-link', limit: 10, windowSeconds: 600, by: 'user' },
  handler: ({ actor }) => slackService.createLinkCode(actor),
});

export const DELETE = route({ auth: 'session', handler: ({ actor }) => slackService.unlink(actor) });
