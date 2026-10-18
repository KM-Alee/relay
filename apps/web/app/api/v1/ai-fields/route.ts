// GET /api/v1/ai-fields?contactId=|opportunityId= (F9.1): AI fields of a record with value, source, timestamp.
import { aiFieldsQuery } from '@relay/contracts/api/crm-extras';
import { aiFieldsService } from '@relay/core/services/crm-ai-fields';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  query: aiFieldsQuery,
  handler: ({ actor, query }) =>
    aiFieldsService.list(
      actor,
      query.contactId
        ? { kind: 'contact', contactId: query.contactId }
        : { kind: 'opportunity', opportunityId: query.opportunityId! },
    ),
});
