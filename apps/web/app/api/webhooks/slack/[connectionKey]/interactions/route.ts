// POST /api/webhooks/slack/[connectionKey]/interactions: Block Kit button clicks (04 §6).
import { handleSlackWebhook } from '@/lib/webhooks/slack';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ connectionKey: string }> }) {
  return handleSlackWebhook(req, ctx.params, 'interactions');
}
