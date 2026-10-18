// GET /api/v1/integrations: integration cards (integrations.view).
import { integrationsService } from '@relay/core/services/integrations';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'integrations.view',
  handler: ({ actor }) => integrationsService.list(actor),
});
