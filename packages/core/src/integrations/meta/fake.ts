// Fake WhatsApp provider for tests, the Judge Console and INTEGRATIONS_FAKE=1 (13 §5).
// Records sends; can mint correctly SIGNED webhook requests; can be told to fail.
import { createMetaAdapter, metaSignature } from './adapter';
import type { E164, MessagingProvider } from '../types';

export interface FakeMeta extends MessagingProvider {
  sent: Array<{
    to: E164;
    kind: 'text' | 'template' | 'media';
    body?: string;
    template?: string;
    id: string;
  }>;
  failNext: Error | null;
  media: Map<string, { bytes: Uint8Array; mime: string }>;
}

export function createFakeMeta(): FakeMeta {
  const real = createMetaAdapter();
  let n = 0;
  const salt = Math.random().toString(36).slice(2, 8); // ids are globally unique (events table), even across test runs
  const take = () => {
    if (f.failNext) {
      const e = f.failNext;
      f.failNext = null;
      throw e;
    }
    n += 1;
    return `wamid.FAKE${salt}${String(n).padStart(6, '0')}`;
  };
  const f: FakeMeta = {
    ...real,
    sent: [],
    failNext: null,
    media: new Map(),
    async sendText(to, body) {
      const id = take();
      f.sent.push({ to, kind: 'text', body, id });
      return { providerMessageId: id };
    },
    async sendTemplate(to, t) {
      const id = take();
      f.sent.push({ to, kind: 'template', template: t.name, id });
      return { providerMessageId: id };
    },
    async sendMedia(to) {
      const id = take();
      f.sent.push({ to, kind: 'media', id });
      return { providerMessageId: id };
    },
    async downloadMedia(mid) {
      const m = f.media.get(mid);
      if (!m) throw new Error('fake media not found');
      return m;
    },
  };
  return f;
}

/** A correctly signed Meta webhook request (raw body + header), for contract tests and the Judge Console. */
export function signedMetaRequest(
  appSecret: string,
  payload: unknown,
  url = 'https://relay.test/api/webhooks/meta/default',
) {
  const rawBody = JSON.stringify(payload);
  return {
    method: 'POST',
    url: new URL(url),
    headers: new Headers({ 'x-hub-signature-256': metaSignature(appSecret, rawBody) }),
    rawBody,
  };
}

/** Build a Meta-shaped inbound text payload. */
export function metaInboundPayload(o: {
  wamid: string;
  from: string; // digits
  name?: string;
  text?: string;
  phoneNumberId?: string;
  type?: 'text' | 'image';
  mediaId?: string;
  ts?: number;
}) {
  const type = o.type ?? 'text';
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: o.phoneNumberId ?? 'PNID' },
              contacts: [{ profile: { name: o.name ?? 'Test Customer' }, wa_id: o.from }],
              messages: [
                {
                  from: o.from,
                  id: o.wamid,
                  timestamp: String(o.ts ?? Math.floor(Date.now() / 1000)),
                  type,
                  ...(type === 'text'
                    ? { text: { body: o.text ?? 'hello' } }
                    : { image: { id: o.mediaId ?? 'MEDIA1', mime_type: 'image/jpeg', caption: o.text } }),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function metaStatusPayload(o: {
  wamid: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  to: string;
  phoneNumberId?: string;
  error?: { code: number; title: string };
}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: o.phoneNumberId ?? 'PNID' },
              statuses: [
                {
                  id: o.wamid,
                  status: o.status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: o.to,
                  ...(o.error ? { errors: [o.error] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
