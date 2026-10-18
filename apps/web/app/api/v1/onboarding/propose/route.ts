// POST /api/v1/onboarding/propose (F9.3): a template, or an AI proposal for a one-sentence description.
// Writes nothing: the Owner reviews and edits, then POST /onboarding/apply.
import { onboardingProposeInput } from '@relay/contracts/api/crm-extras';
import { onboardingService } from '@relay/core/services/crm-onboarding';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route({
  auth: 'session',
  permission: 'crm.config.manage',
  body: onboardingProposeInput,
  rateLimit: { name: 'onboarding.propose', limit: 10, windowSeconds: 60, by: 'user' },
  handler: ({ actor, body }) => onboardingService.propose(actor, body),
});
