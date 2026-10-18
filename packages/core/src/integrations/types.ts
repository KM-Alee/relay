// Adapter interfaces shared by all providers (docs/04-integrations.md §1). Owner: Lane C.
// Adapters are thin translators: no DB access, no business rules. They get DECRYPTED credentials from
// the caller and throw ProviderError; the job runner maps `kind` to retry / fail / needs_reconnect.

export type Creds = Record<string, string>;
export type RawRequest = { method: string; url: URL; headers: Headers; rawBody: string };

export type ProviderErrorKind = 'temporary' | 'permanent' | 'auth';

/** `kind` is read structurally by the outbox runner (decideFailure): keep the property names. */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  constructor(
    readonly kind: ProviderErrorKind,
    readonly code: string,
    message?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message ?? code);
  }
}

export interface SlackCommand {
  command: string;
  text: string;
  teamId: string;
  userId: string;
  responseUrl: string;
  triggerId: string;
  apiAppId: string | null;
}

export interface SlackInteraction {
  type: string;
  teamId: string | null;
  userId: string;
  triggerId: string;
  responseUrl: string | null;
  apiAppId: string | null;
  channelId: string | null;
  messageTs: string | null;
  /** First action only (we only ever render one button per alert). */
  action: { actionId: string; value: string; actionTs: string } | null;
}

export type SlackMessage = { blocks: unknown[]; text: string };

export interface Notifier {
  verifyRequest(req: RawRequest, creds: Creds, now?: Date): { ok: true } | { ok: false; reason: string };
  parseCommand(req: RawRequest): SlackCommand;
  parseInteraction(req: RawRequest): SlackInteraction;
  /** conversations.open + chat.postMessage → the DM channel id and message ts. */
  sendAlert(slackUserId: string, msg: SlackMessage, creds: Creds): Promise<{ channel: string; ts: string }>;
  updateAlert(channel: string, ts: string, msg: SlackMessage, creds: Creds): Promise<void>;
  /** Post to a response_url (ephemeral by default). */
  respond(responseUrl: string, text: string): Promise<void>;
  /** auth.test: connectivity probe. */
  authTest(creds: Creds): Promise<{ teamId: string; botUserId: string }>;
}

// ── Messaging (Meta WhatsApp Cloud API, docs/04 §1 + §3). Phone numbers are E.164 with a leading '+'. ──
export type E164 = string;

export type ParsedMessagingEvent =
  | {
      type: 'inbound';
      /** wamid (dedupe key, I1.8) */
      externalEventId: string;
      phoneNumberId: string | null;
      from: E164;
      profileName?: string;
      at: Date;
      kind: 'text' | 'audio' | 'image' | 'document' | 'other';
      text?: string;
      providerMediaId?: string;
      mime?: string;
      filename?: string;
    }
  | {
      type: 'status';
      /** `wamid:status` */
      externalEventId: string;
      phoneNumberId: string | null;
      providerMessageId: string;
      status: 'sent' | 'delivered' | 'read' | 'failed';
      at: Date;
      errorCode?: string;
      errorTitle?: string;
    };

export interface MessagingProvider {
  id: 'meta_whatsapp';
  /** X-Hub-Signature-256 over the RAW body, constant-time. Fails closed when the app secret is missing. */
  verifyWebhook(req: RawRequest, creds: Creds): { ok: true } | { ok: false; reason: string };
  /** GET hub.challenge handshake; null when the request is not a handshake. */
  handshake(req: RawRequest, creds: Creds): Response | null;
  /** One HTTP body to many events. Call ONLY after verifyWebhook succeeded. */
  parseWebhook(req: RawRequest): ParsedMessagingEvent[];
  sendText(to: E164, body: string, creds: Creds): Promise<{ providerMessageId: string }>;
  sendTemplate(
    to: E164,
    t: { name: string; lang: string; params: string[] },
    creds: Creds,
  ): Promise<{ providerMessageId: string }>;
  sendMedia(
    to: E164,
    m: { url: string; mime: string; caption?: string },
    creds: Creds,
  ): Promise<{ providerMessageId: string }>;
  downloadMedia(providerMediaId: string, creds: Creds): Promise<{ bytes: Uint8Array; mime: string }>;
}

// ── Payments (Stripe test mode, T-143; 04 §4) ───────────────────────────
/** The slice of a Stripe event we use (the SDK's Event type is not leaked past the adapter). */
export interface PaymentEvent {
  id: string;
  type: string;
  created: number;
  /** Raw `data.object` (only read by `normalizePaymentEvent`; never stored whole). */
  object: Record<string, unknown>;
}

export interface CheckoutInput {
  amountMinor: number;
  /** Lowercase or uppercase ISO code; the adapter lowercases. */
  currency: string;
  description: string;
  paymentRequestId: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt?: Date;
  /** Provider idempotency key (retries never create a second session). */
  idempotencyKey: string;
}

export interface PaymentProvider {
  /** Verify the signature over the RAW body (constant-time, 5 min tolerance) BEFORE anything is parsed. */
  verifyWebhook(
    req: RawRequest,
    creds: Creds,
  ): { ok: true; event: PaymentEvent } | { ok: false; reason: string };
  createCheckout(
    i: CheckoutInput,
    creds: Creds,
  ): Promise<{ providerRef: string; url: string; expiresAt: Date }>;
  expireCheckout(providerRef: string, creds: Creds): Promise<void>;
}

// ── Calendar (Google, T-144; 04 §5) ─────────────────────────────────────
export interface OAuthTokens {
  accessToken: string;
  /** Absent on refresh responses (Google keeps the original refresh token). */
  refreshToken?: string;
  expiresAt: Date;
  /** Account email from the id_token (display only). */
  email?: string;
}

export type CalEvent = {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  /** IANA zone. */
  timeZone: string;
  attendeeEmail?: string;
  /** Deterministic event id (base32hex-safe) so retries never duplicate. */
  eventId: string;
};

export interface CalendarProvider {
  authUrl(i: { state: string; codeChallenge: string; redirectUri: string; loginHint?: string }): string;
  exchangeCode(i: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokens>;
  /** Throws ProviderError{kind:'auth'} on invalid_grant. */
  refresh(refreshToken: string): Promise<OAuthTokens>;
  revoke(token: string): Promise<void>;
  freeBusy(accessToken: string, from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>>;
  createEvent(accessToken: string, e: CalEvent): Promise<{ providerEventId: string; htmlLink: string }>;
  updateEvent(accessToken: string, providerEventId: string, e: CalEvent): Promise<{ htmlLink: string }>;
  cancelEvent(accessToken: string, providerEventId: string): Promise<void>;
}
