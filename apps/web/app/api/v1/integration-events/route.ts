// GET /api/v1/integration-events: sync history (integrations.view).
import { integrationEventsQuery } from '@relay/contracts/api/integrations';
import { integrationsService } from '@relay/core/services/integrations';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'integrations.view',
  query: integrationEventsQuery,
  handler: ({ actor, query }) => integrationsService.events(actor, query),
});
