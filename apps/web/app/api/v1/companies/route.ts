// GET/POST /api/v1/companies (F2.1).
import { pageQuery, companyInput } from '@relay/contracts/api/crm';
import { companiesService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.company.view',
  query: pageQuery,
  handler: ({ actor, query }) => companiesService.list(actor, query),
});

export const POST = route({
  auth: 'session',
  permission: 'crm.company.create',
  body: companyInput,
  status: 201,
  handler: ({ actor, body }) => companiesService.create(actor, body),
});
