// DELETE /api/v1/integrations/:provider: disconnect (integrations.manage). Secrets are wiped.
import { providerParams } from '@relay/contracts/api/integrations';
import { integrationsService } from '@relay/core/services/integrations';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const DELETE = route({
  auth: 'session',
  permission: 'integrations.manage',
  params: providerParams,
  handler: ({ actor, params }) => integrationsService.disconnect(actor, params.provider),
});
