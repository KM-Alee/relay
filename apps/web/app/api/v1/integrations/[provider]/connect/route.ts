// POST /api/v1/integrations/:provider/connect: connect or rotate secrets (integrations.manage).
import { connectIntegrationInput, providerParams } from '@relay/contracts/api/integrations';
import { integrationsService } from '@relay/core/services/integrations';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'integrations.manage',
  params: providerParams,
  body: connectIntegrationInput,
  rateLimit: { name: 'integrations.connect', limit: 20, windowSeconds: 60, by: 'user' },
  handler: ({ actor, params, body }) => integrationsService.connect(actor, params.provider, body),
});
