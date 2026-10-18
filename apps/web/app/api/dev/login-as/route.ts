// GET /api/dev/login-as: seed users for the dev login page. 404 unless dev tools are on (13 §5).
// T-101 adds POST { userId } → creates a session for that seed user (same guard).
import { devLoginService } from '@relay/core/services/dev-login';
import { assertDevTools } from '@/lib/dev/guard';
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({
  auth: 'public',
  handler: async () => {
    assertDevTools();
    return { users: await devLoginService.listSeedUsers() };
  },
});
