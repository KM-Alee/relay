// GET/POST /api/v1/custom-fields (F2.2, F2.3).
import { customFieldsQuery, customFieldInput } from '@relay/contracts/api/crm';
import { customFieldsService } from '@relay/core/services/crm-config';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  query: customFieldsQuery,
  handler: ({ actor, query }) => customFieldsService.list(actor, query),
});

export const POST = route({
  auth: 'session',
  permission: 'crm.config.manage',
  body: customFieldInput,
  status: 201,
  handler: ({ actor, body }) => customFieldsService.create(actor, body),
});
