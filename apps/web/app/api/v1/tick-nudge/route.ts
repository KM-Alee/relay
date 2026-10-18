// POST /api/v1/tick-nudge: a countdown hit 0 in someone's browser → run due work now (07 §3).
// Session + CSRF, rate-limited `nudge:user:<id>` 6/min (06 §1). Accepts no input and changes
// nothing by itself: the tick only executes what Postgres says is due. Owner: Lane A (T-008).
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  rateLimit: { name: 'nudge', limit: 6, windowSeconds: 60, by: 'user' },
  status: 202,
  handler: () => {
    kickDueWork('nudge');
    return { accepted: true as const };
  },
});
