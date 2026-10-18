// GET/POST /api/v1/ai/templates: localized message templates (name, language, body with {{1}} placeholders).
import { templateInput } from '@relay/contracts/api/ai';
import { aiAdminService } from '@relay/core/services/ai-admin';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'ai.manage',
  handler: ({ actor }) => aiAdminService.templatesList(actor),
});

export const POST = route({
  auth: 'session',
  permission: 'ai.manage',
  body: templateInput,
  status: 201,
  handler: ({ actor, body }) => aiAdminService.templatesCreate(actor, body),
});
