// GET/POST /api/v1/ai/knowledge (F6.5): the knowledge base the stand-in answers from.
import { kbInput } from '@relay/contracts/api/ai';
import { aiAdminService } from '@relay/core/services/ai-admin';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'ai.manage',
  handler: ({ actor }) => aiAdminService.kbList(actor),
});

export const POST = route({
  auth: 'session',
  permission: 'ai.manage',
  body: kbInput,
  status: 201,
  handler: ({ actor, body }) => aiAdminService.kbCreate(actor, body),
});
