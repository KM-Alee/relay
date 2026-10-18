// GET /api/v1/leads (own, or all with leads.view_all) · POST /api/v1/leads (leads.create, T1 manual). Lane A.
import { createLeadInput, leadsListQuery } from '@relay/contracts/api/leads';
import { leadsService } from '@relay/core/services/leads';
import { kickDueWork } from '@/lib/jobs/kick';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  query: leadsListQuery,
  handler: ({ actor, query }) => leadsService.list(actor, query),
});

export const POST = route({
  auth: 'session',
  permission: 'leads.create',
  body: createLeadInput,
  rateLimit: { name: 'leads.create', limit: 30, windowSeconds: 60, by: 'user' },
  status: 201,
  handler: async ({ actor, body }) => {
    const lead = await leadsService.createManual(actor, body);
    kickDueWork(); // Slack alert + wake-up go out now
    return lead;
  },
});
