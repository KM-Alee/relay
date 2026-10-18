// POST /api/v1/onboarding/apply (F9.3): apply the reviewed proposal in ONE transaction. Audited.
import { onboardingApplyInput } from '@relay/contracts/api/crm-extras';
import { onboardingService } from '@relay/core/services/crm-onboarding';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'crm.config.manage',
  body: onboardingApplyInput,
  rateLimit: { name: 'onboarding.apply', limit: 10, windowSeconds: 60, by: 'user' },
  handler: ({ actor, body }) => onboardingService.apply(actor, body),
});
