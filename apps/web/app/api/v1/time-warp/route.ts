// GET/PUT /api/v1/time-warp (F10.2): read (any member) / set (workspace.settings, demo workspaces only). Lane A.
import { setTimeWarpInput } from '@relay/contracts/api/automations';
import { timeWarpService } from '@relay/core/services/time-warp';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  handler: ({ actor }) => timeWarpService.get(actor),
});

export const PUT = route({
  auth: 'session',
  permission: 'workspace.settings',
  body: setTimeWarpInput,
  handler: async ({ actor, body }) => {
    const out = await timeWarpService.set(actor, body.multiplier);
    kickDueWork();
    return out;
  },
});
