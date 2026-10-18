// GET /api/v1/judge: Judge Console scenario registry (demo.judge_console + DEMO_MODE; F10.1).
import { judgeService } from '@relay/core/services/judge';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'demo.judge_console',
  handler: ({ actor }) => judgeService.list(actor),
});
