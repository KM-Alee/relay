// GET /api/health: liveness + DB ping for uptime checks and deploy verification (T-004, Q18).
// Public and deliberately dependency-light: no session, CSRF or rate-limit machinery (it must answer
// even when SESSION_SECRET is broken). Returns no secrets and no tenant data; 503 when the DB is down.
import { checkHealth } from '@relay/core/services/health';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(): Promise<Response> {
  const report = await checkHealth();
  return Response.json(report, {
    status: report.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
