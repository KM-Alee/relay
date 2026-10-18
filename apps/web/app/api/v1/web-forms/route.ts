// GET /api/v1/web-forms (routing.manage): public web forms + lead sources (F3.1). Lane A.
import { policiesService } from '@relay/core/services/policies';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'routing.manage',
  handler: ({ actor }) => policiesService.intakeSettings(actor),
});
