// Shared Slack webhook handler (04 §2): raw body -> verify -> record (+outbox) -> 200 -> after() process.
// Never parses or acts before the signature is verified (that is inside ingestSlack).
import { log } from '@relay/core/log';
import '@relay/core/services/register-hooks';
import { ingestSlack } from '@relay/core/services/integrations-ingest';
import { processSlackEvent } from '@relay/core/services/slack';
import { after } from 'next/server';
import { clientIp } from '@/lib/http/request';

export async function handleSlackWebhook(
  req: Request,
  params: Promise<{ connectionKey: string }>,
  endpoint: 'commands' | 'interactions',
): Promise<Response> {
  const rawBody = await req.text(); // BEFORE any parsing
  const { connectionKey } = await params;
  let result;
  try {
    result = await ingestSlack({
      connectionKey,
      endpoint,
      req: { method: req.method, url: new URL(req.url), headers: req.headers, rawBody },
      ip: clientIp(req),
    });
  } catch (err) {
    log.error('slack.webhook_failed', { endpoint, err });
    // 5xx: Slack shows an error to the user; the signature was not the problem.
    return new Response('error', { status: 500 });
  }
  if (result.newEvents.length) {
    // Process now (the outbox row remains as the retry safety net; processing is idempotent by status).
    after(async () => {
      for (const e of result.newEvents) {
        try {
          await processSlackEvent(e.eventId, e.workspaceId);
        } catch (err) {
          log.error('slack.after_process_failed', { eventId: e.eventId, err });
        }
      }
    });
  }
  const text = result.status === 401 ? 'bad signature' : result.status === 404 ? 'not found' : 'ok';
  return new Response(result.status === 200 ? null : text, { status: result.status });
}
