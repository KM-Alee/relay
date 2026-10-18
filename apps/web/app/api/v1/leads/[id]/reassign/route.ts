// POST /api/v1/leads/:id/reassign (leads.reassign): T7 manual reassign, fresh window (03 T7). Lane A.
// Ineligible target → 422 unless override + reason (audited); inactive target never; stale → 409.
import { leadIdParams, reassignInput } from '@relay/contracts/api/leads';
import { leadActionsService } from '@relay/core/services/lead-actions';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'leads.reassign',
  params: leadIdParams,
  body: reassignInput,
  rateLimit: { name: 'leads.reassign', limit: 60, windowSeconds: 60, by: 'user' },
  handler: async ({ actor, params, body }) => {
    const lead = await leadActionsService.reassign(actor, params.id, body);
    kickDueWork();
    return lead;
  },
});
