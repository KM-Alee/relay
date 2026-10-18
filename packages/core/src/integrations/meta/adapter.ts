// Meta WhatsApp Cloud API adapter (I1.0-I1.3, I1.11; docs/04-integrations.md §3). Thin translator: no DB.
// Verified 2026-10-18 against developers.facebook.com: latest Graph version v26.0 (2026-07-29), v25.0 valid
// to 2028-07; send = POST /{phone-number-id}/messages {messaging_product:'whatsapp', to, type, ...};
// response {messages:[{id}]}; webhook = entry[].changes[].value.{metadata,contacts,messages,statuses};
// signature = X-Hub-Signature-256 "sha256=" + HMAC-SHA256(raw body, app secret); media = GET /{media-id}
// -> {url, mime_type}, then GET url with the bearer token.
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ProviderError,
  type Creds,
  type MessagingProvider,
  type ParsedMessagingEvent,
  type RawRequest,
} from '../types';

export const DEFAULT_GRAPH_VERSION = 'v25.0';
const GRAPH = 'https://graph.facebook.com/';

export function metaSignature(appSecret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
}

/** Normalise a WhatsApp id/phone (digits) to E.164 with a leading '+'. */
export function toE164(v: string): string {
  return '+' + v.replace(/\D/g, '');
}

export type FailureReason =
  | 'recipient_not_allowed'
  | 'window_closed'
  | 'token_expired'
  | 'undeliverable'
  | 'template_invalid'
  | 'rate_limited'
  | 'unknown';

/** Meta error code -> plain reason key (i18n: inbox.failure.<key>) + retry class (I1.7). */
export function classifyMetaError(
  code: number | string | undefined,
  httpStatus?: number,
): { kind: 'temporary' | 'permanent' | 'auth'; reason: FailureReason } {
  const c = Number(code);
  if (c === 190 || c === 102 || httpStatus === 401) return { kind: 'auth', reason: 'token_expired' };
  if (c === 131030) return { kind: 'permanent', reason: 'recipient_not_allowed' };
  if (c === 131047 || c === 131049) return { kind: 'permanent', reason: 'window_closed' };
  if (c === 131026 || c === 131021) return { kind: 'permanent', reason: 'undeliverable' };
  if ((c >= 132000 && c < 133000) || c === 100 || c === 131008 || c === 131009)
    return { kind: 'permanent', reason: 'template_invalid' };
  if ([4, 17, 32, 613, 80007, 130429, 131048, 131056].includes(c))
    return { kind: 'temporary', reason: 'rate_limited' };
  if ([1, 2, 131000, 131016].includes(c) || (httpStatus !== undefined && httpStatus >= 500))
    return { kind: 'temporary', reason: 'unknown' };
  if (httpStatus === 429) return { kind: 'temporary', reason: 'rate_limited' };
  return { kind: 'permanent', reason: 'unknown' };
}

export interface MetaAdapterOptions {
  fetchImpl?: typeof fetch;
}

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function createMetaAdapter(opts: MetaAdapterOptions = {}): MessagingProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const version = (c: Creds) => c.graphVersion || DEFAULT_GRAPH_VERSION;

  async function graph(path: string, c: Creds, init: RequestInit = {}): Promise<Response> {
    if (!c.accessToken) throw new ProviderError('auth', 'missing_access_token');
    let res: Response;
    try {
      res = await doFetch(`${GRAPH}${version(c)}/${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${c.accessToken}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ProviderError('temporary', 'network', 'meta request failed');
    }
    if (res.ok) return res;
    let code: number | undefined;
    let title = '';
    try {
      const j = (await res.json()) as Loose;
      code = j?.error?.code;
      title = String(j?.error?.error_data?.details ?? j?.error?.message ?? '');
    } catch {
      /* non-JSON error body */
    }
    const cls = classifyMetaError(code, res.status);
    const ra = Number(res.headers.get('retry-after'));
    throw new ProviderError(
      cls.kind,
      cls.reason,
      `meta ${res.status} code=${code ?? '?'} ${title}`.slice(0, 300),
      ra > 0 ? ra * 1000 : undefined,
    );
  }

  async function send(c: Creds, body: Loose): Promise<{ providerMessageId: string }> {
    if (!c.phoneNumberId) throw new ProviderError('permanent', 'missing_phone_number_id');
    const res = await graph(`${c.phoneNumberId}/messages`, c, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body }),
    });
    const j = (await res.json()) as Loose;
    const id = j?.messages?.[0]?.id;
    if (typeof id !== 'string') throw new ProviderError('temporary', 'no_message_id', 'meta: no message id');
    return { providerMessageId: id };
  }

  const toPlain = (to: string) => to.replace(/^\+/, '');

  return {
    id: 'meta_whatsapp',

    verifyWebhook(req: RawRequest, creds: Creds) {
      if (!creds.appSecret) return { ok: false, reason: 'app_secret_missing' }; // fail closed
      const got = req.headers.get('x-hub-signature-256');
      if (!got) return { ok: false, reason: 'missing_signature' };
      const expected = Buffer.from(metaSignature(creds.appSecret, req.rawBody));
      const gotB = Buffer.from(got);
      if (gotB.length !== expected.length || !timingSafeEqual(gotB, expected))
        return { ok: false, reason: 'bad_signature' };
      return { ok: true };
    },

    handshake(req: RawRequest, creds: Creds) {
      const q = req.url.searchParams;
      if (q.get('hub.mode') !== 'subscribe') return null;
      const token = q.get('hub.verify_token') ?? '';
      const expected = creds.verifyToken ?? '';
      const a = Buffer.from(token);
      const b = Buffer.from(expected);
      const ok = !!expected && a.length === b.length && timingSafeEqual(a, b);
      if (!ok) return new Response('forbidden', { status: 403 });
      return new Response(q.get('hub.challenge') ?? '', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    },

    parseWebhook(req: RawRequest): ParsedMessagingEvent[] {
      const body = JSON.parse(req.rawBody) as Loose;
      const out: ParsedMessagingEvent[] = [];
      for (const entry of body?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
          const v = change?.value as Loose | undefined;
          if (!v) continue;
          const phoneNumberId: string | null = v.metadata?.phone_number_id ?? null;
          const names = new Map<string, string>();
          for (const ct of v.contacts ?? []) if (ct?.wa_id) names.set(String(ct.wa_id), ct.profile?.name);
          for (const m of v.messages ?? []) {
            if (!m?.id || !m?.from) continue;
            const type = String(m.type);
            const media = m[type] as Loose | undefined;
            const kind: 'text' | 'audio' | 'image' | 'document' | 'other' =
              type === 'text'
                ? 'text'
                : type === 'audio' || type === 'image' || type === 'document'
                  ? type
                  : 'other';
            out.push({
              type: 'inbound',
              externalEventId: String(m.id),
              phoneNumberId,
              from: toE164(String(m.from)),
              profileName: names.get(String(m.from)),
              at: new Date(Number(m.timestamp) * 1000),
              kind,
              text:
                type === 'text'
                  ? String(m.text?.body ?? '')
                  : typeof media?.caption === 'string'
                    ? media.caption
                    : type === 'button'
                      ? String(m.button?.text ?? '')
                      : undefined,
              providerMediaId: kind === 'text' || kind === 'other' ? undefined : media?.id,
              mime: kind === 'text' || kind === 'other' ? undefined : media?.mime_type,
              filename: type === 'document' ? media?.filename : undefined,
            });
          }
          for (const s of v.statuses ?? []) {
            if (!s?.id || !s?.status) continue;
            const status = String(s.status);
            if (!['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
            const err = s.errors?.[0] as Loose | undefined;
            out.push({
              type: 'status',
              externalEventId: `${s.id}:${status}`,
              phoneNumberId,
              providerMessageId: String(s.id),
              status: status as 'sent' | 'delivered' | 'read' | 'failed',
              at: new Date(Number(s.timestamp) * 1000),
              errorCode: err?.code !== undefined ? String(err.code) : undefined,
              errorTitle: err ? String(err.title ?? err.message ?? '') : undefined,
            });
          }
        }
      }
      return out;
    },

    sendText: (to, body, c) => send(c, { to: toPlain(to), type: 'text', text: { body, preview_url: false } }),

    sendTemplate: (to, t, c) =>
      send(c, {
        to: toPlain(to),
        type: 'template',
        template: {
          name: t.name,
          language: { code: t.lang },
          ...(t.params.length
            ? {
                components: [{ type: 'body', parameters: t.params.map((text) => ({ type: 'text', text })) }],
              }
            : {}),
        },
      }),

    sendMedia: (to, m, c) => {
      const type = m.mime.startsWith('image/') ? 'image' : m.mime.startsWith('audio/') ? 'audio' : 'document';
      return send(c, {
        to: toPlain(to),
        type,
        [type]: { link: m.url, ...(m.caption && type !== 'audio' ? { caption: m.caption } : {}) },
      });
    },

    async downloadMedia(providerMediaId, c) {
      const meta = (await (await graph(providerMediaId, c)).json()) as Loose;
      if (typeof meta?.url !== 'string') throw new ProviderError('permanent', 'media_no_url');
      let res: Response;
      try {
        res = await doFetch(meta.url, {
          headers: { authorization: `Bearer ${c.accessToken}` },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new ProviderError('temporary', 'network', 'media download failed');
      }
      if (!res.ok)
        throw new ProviderError(res.status >= 500 ? 'temporary' : 'permanent', `media_${res.status}`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        mime: String(meta.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream'),
      };
    },
  };
}
