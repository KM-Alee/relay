// Shared Meta WhatsApp webhook handler (04 §2-§3): raw body -> verify -> record (+outbox) -> 200 -> after() process.
// Nothing is parsed or acted on before the signature is verified (that is inside ingestWhatsApp).
import { log } from '@relay/core/log';
import { handleMetaHandshake, ingestWhatsApp } from '@relay/core/services/messaging-ingest';
import { processWhatsAppEvent } from '@relay/core/services/messaging';
import { after } from 'next/server';
import { clientIp } from '@/lib/http/request';

type Params = Promise<{ connectionKey: string }>;

export async function handleMetaGet(req: Request, params: Params): Promise<Response> {
  const { connectionKey } = await params;
  try {
    return await handleMetaHandshake(connectionKey, {
      method: 'GET',
      url: new URL(req.url),
      headers: req.headers,
      rawBody: '',
    });
  } catch (err) {
    log.error('whatsapp.handshake_failed', { err });
    return new Response('error', { status: 500 });
  }
}

export async function handleMetaPost(req: Request, params: Params): Promise<Response> {
  const rawBody = await req.text(); // BEFORE any parsing
  const { connectionKey } = await params;
  let result;
  try {
    result = await ingestWhatsApp({
      connectionKey,
      req: { method: req.method, url: new URL(req.url), headers: req.headers, rawBody },
      ip: clientIp(req),
    });
  } catch (err) {
    log.error('whatsapp.webhook_failed', { err });
    return new Response('error', { status: 500 }); // Meta retries
  }
  if (result.newEvents.length) {
    after(async () => {
      for (const e of result.newEvents) {
        try {
          await processWhatsAppEvent(e.eventId, e.workspaceId);
        } catch (err) {
          log.warn('whatsapp.after_process_failed', { eventId: e.eventId, err }); // outbox retries
        }
      }
    });
  }
  const text: Record<number, string> = {
    401: 'bad signature',
    404: 'not found',
    503: 'unavailable',
    400: 'bad request',
  };
  return new Response(result.status === 200 ? 'ok' : (text[result.status] ?? 'error'), {
    status: result.status,
  });
}
