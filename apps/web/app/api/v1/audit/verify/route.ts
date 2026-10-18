// POST /api/v1/audit/verify: recompute the workspace's audit hash chain (F4.4). Perm audit.view.
import { auditService } from '@relay/core/services/audit';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({
  auth: 'session',
  permission: 'audit.view',
  rateLimit: { name: 'audit.verify', limit: 6, windowSeconds: 60, by: 'user' },
  handler: ({ actor }) => auditService.verify(actor),
});
