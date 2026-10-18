// GET /api/v1/audit (audit.view; F4.2): filter by type/user/date, newest first. READ-ONLY (F4.3):
// a test enumerates every route under /api/v1/audit and asserts there is no mutation.
import { auditListQuery } from '@relay/contracts/api/audit';
import { auditService } from '@relay/core/services/audit';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'session',
  permission: 'audit.view',
  query: auditListQuery,
  handler: ({ actor, query }) => auditService.list(actor, query),
});
