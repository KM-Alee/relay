// POST /api/v1/integrations/:provider/breaker: force the circuit open/closed (Judge Console, I5.8).
import { forceBreakerInput, providerParams } from '@relay/contracts/api/integrations';
import { integrationsService } from '@relay/core/services/integrations';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'integrations.manage',
  params: providerParams,
  body: forceBreakerInput,
  handler: ({ actor, params, body }) => integrationsService.forceBreaker(actor, params.provider, body.state),
});
