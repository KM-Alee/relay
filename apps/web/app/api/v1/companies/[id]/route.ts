// GET/PATCH/DELETE /api/v1/companies/:id.
import { idParams, companyUpdateInput } from '@relay/contracts/api/crm';
import { companiesService } from '@relay/core/services/crm-records';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.company.view',
  params: idParams,
  handler: ({ actor, params }) => companiesService.get(actor, params.id),
});

export const PATCH = route({
  auth: 'session',
  permission: 'crm.company.edit',
  params: idParams,
  body: companyUpdateInput,
  handler: ({ actor, params, body }) => companiesService.update(actor, params.id, body),
});

export const DELETE = route({
  auth: 'session',
  permission: 'crm.company.delete',
  params: idParams,
  handler: ({ actor, params }) => companiesService.remove(actor, params.id),
});
