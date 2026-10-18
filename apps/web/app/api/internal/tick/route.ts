// POST /api/internal/tick: run due work (01 §6). Called by QStash wake-ups + the QStash cron
// backstop (Upstash-Signature) and by operators (Bearer CRON_SECRET). Owner: Lane A (T-008).
import { createTickHandler } from '@/lib/jobs/tick-handler';

export const dynamic = 'force-dynamic';
// TICK_BUDGET_MS (20 s) bounds the work; leave headroom for the job_runs write and the wake publish.
export const maxDuration = 60;

const handler = createTickHandler();

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
