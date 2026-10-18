// GET /api/v1/lead-sources: manual-entry sources (F3.1). Lane A.
import { leadsService } from '@relay/core/services/leads';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'leads.create',
  handler: ({ actor }) => leadsService.sources(actor),
});
