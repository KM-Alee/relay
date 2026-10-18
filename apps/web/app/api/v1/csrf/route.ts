// GET /api/v1/csrf: issues the `csrf` cookie (route() adds it when missing/invalid) so the client can
// send `x-csrf-token` on its first mutation (e.g. login). Public, no data.
import { route } from '@/lib/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'public', handler: () => ({ ok: true }) });
