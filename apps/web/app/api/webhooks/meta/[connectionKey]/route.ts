// /api/webhooks/meta/[connectionKey]: Meta WhatsApp Cloud API webhook (I1.1 handshake, I1.2 signature, I1.8 dedupe).
import { handleMetaGet, handleMetaPost } from '@/lib/webhooks/meta';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ connectionKey: string }> }) {
  return handleMetaGet(req, ctx.params);
}

export async function POST(req: Request, ctx: { params: Promise<{ connectionKey: string }> }) {
  return handleMetaPost(req, ctx.params);
}
