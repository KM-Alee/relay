// GET /api/v1/onboarding/templates (F9.3): the built-in Real estate / Solar / Clinic starter setups (no AI needed).
import { onboardingService } from '@relay/core/services/crm-onboarding';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'crm.config.manage',
  handler: ({ actor }) => onboardingService.templates(actor),
});
