// POST /api/v1/judge/:scenario: run one Judge Console scenario in the caller's workspace (F10.1).
import { judgeParams } from '@relay/contracts/api/judge';
import { judgeService } from '@relay/core/services/judge';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route({
  auth: 'session',
  permission: 'demo.judge_console',
  params: judgeParams,
  rateLimit: { name: 'judge.run', limit: 120, windowSeconds: 60, by: 'user' },
  handler: ({ actor, params, req }) => judgeService.run(actor, params.scenario, new URL(req.url).origin),
});
