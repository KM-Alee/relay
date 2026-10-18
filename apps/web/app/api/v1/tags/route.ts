// GET/POST /api/v1/tags (F2.1).
import { tagInput } from '@relay/contracts/api/crm';
import { tagsService } from '@relay/core/services/crm-config';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  handler: ({ actor }) => tagsService.list(actor),
});

export const POST = route({
  auth: 'session',
  permission: 'crm.tags.manage',
  body: tagInput,
  status: 201,
  handler: ({ actor, body }) => tagsService.create(actor, body),
});
