// POST /api/v1/ai-fields/fill (F9.1): (re)fill one or all AI fields of a record. A human-set value is locked
// unless `force`. Edit permission of the record's entity is checked by the service; AI off -> `ai_disabled`.
import { aiFieldsFillInput } from '@relay/contracts/api/crm-extras';
import { aiFieldsService } from '@relay/core/services/crm-ai-fields';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  body: aiFieldsFillInput,
  rateLimit: { name: 'ai.field_fill', limit: 30, windowSeconds: 60, by: 'user' },
  handler: ({ actor, body }) =>
    aiFieldsService.fill(
      actor,
      body.contactId
        ? { kind: 'contact', contactId: body.contactId }
        : { kind: 'opportunity', opportunityId: body.opportunityId! },
      { fieldId: body.fieldId, force: body.force },
    ),
});
