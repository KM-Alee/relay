# 04 — Integrations

> **Status:** Accepted spec. Requirement IDs: I1.0–I1.11, I2.1–I2.8, I3.1–I3.9, I4.1–I4.5, I5.1–I5.9, I6 (detail in `05-ai.md`), F3.9, F6.13, F10.1.
> **Code home:** `packages/core/src/integrations/<kind>/<provider>.ts` (adapters), `packages/core/src/jobs/outbox/*` (handlers), `apps/web/app/api/webhooks/[provider]/[connectionKey]/route.ts` (ingress).
> **Rule zero:** an integration failing must never block intake, assignment, escalation or in-app alerts (I5.8, C20). Every outbound call happens from the outbox. Every inbound call is verify → record → 200 → process later.
> Facts marked **(verify)** change over time. Confirm them in the provider docs at build time and note the date in `docs/12-demo-and-ops.md`.

## 1. Adapter interfaces (`packages/core/src/integrations/types.ts`)

Adapters are thin translators. They do no DB access and contain no business rules. They receive decrypted credentials from the caller and return normalized data or throw `ProviderError { kind: 'temporary'|'permanent'|'auth', code, message, retryAfterMs? }`. The job runner maps `kind` to retry, give up, or mark `needs_reconnect`.

```ts
type Creds = Record<string, string>;            // decrypted secrets_enc + public_config
type RawRequest = { method: string; url: URL; headers: Headers; rawBody: string };

// I1.0 — required: Meta. Optional: Twilio, Vonage.
interface MessagingProvider {
  id: 'meta_whatsapp' | 'twilio_whatsapp';
  verifyWebhook(req: RawRequest, creds: Creds): { ok: true } | { ok: false; reason: string };
  handshake?(req: RawRequest, creds: Creds): Response | null;          // Meta GET hub.challenge
  parseWebhook(req: RawRequest): ParsedMessagingEvent[];              // one HTTP body → many events
  sendText(to: E164, body: string, creds: Creds): Promise<{ providerMessageId: string }>;
  sendTemplate(to: E164, t: { name: string; lang: string; params: string[] }, creds: Creds): Promise<{ providerMessageId: string }>;
  sendMedia(to: E164, m: { url: string; mime: string; caption?: string }, creds: Creds): Promise<{ providerMessageId: string }>;
  downloadMedia(providerMediaId: string, creds: Creds): Promise<{ bytes: Uint8Array; mime: string }>;
}
type ParsedMessagingEvent =
  | { type: 'inbound'; externalEventId: string /* wamid */; from: E164; profileName?: string; at: Date;
      kind: 'text'|'audio'|'image'|'document'|'other'; text?: string; providerMediaId?: string; mime?: string }
  | { type: 'status'; externalEventId: string /* wamid:status */; providerMessageId: string;
      status: 'sent'|'delivered'|'read'|'failed'; at: Date; errorCode?: string; errorTitle?: string };

interface PaymentProvider {                                            // Stripe
  verifyWebhook(req: RawRequest, creds: Creds): { ok: true; event: StripeEvent } | { ok: false; reason: string };
  createCheckout(i: { amountMinor: number; currency: string; description: string;
    paymentRequestId: string; successUrl: string; cancelUrl: string; expiresAt?: Date }, creds: Creds)
    : Promise<{ providerRef: string; url: string; expiresAt: Date }>;
  expireCheckout(providerRef: string, creds: Creds): Promise<void>;
}

interface CalendarProvider {                                           // Google
  authUrl(i: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(i: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;                 // throws ProviderError{kind:'auth'} on invalid_grant
  revoke(token: string): Promise<void>;
  freeBusy(t: AccessToken, from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>>;
  createEvent(t: AccessToken, e: CalEvent): Promise<{ providerEventId: string; htmlLink: string }>;
  updateEvent(t: AccessToken, id: string, e: CalEvent): Promise<void>;
  cancelEvent(t: AccessToken, id: string): Promise<void>;
}
type CalEvent = { title: string; description?: string; start: Date; end: Date; timeZone: string /* IANA */;
  attendeeEmail?: string; idempotencyKey: string };

interface Notifier {                                                   // Slack (core/integrations/slack/)
  verifyRequest(req: RawRequest, creds: Creds): { ok: boolean; reason?: string };   // v0 HMAC-SHA256 + 5 min window
  parseCommand(req: RawRequest): SlackCommand;                        // /relay link <code> | help
  parseInteraction(req: RawRequest): SlackInteraction;                // block_actions (lead_ack, lead_claim)
  sendAlert(slackUserId: string, a: { blocks: unknown[]; text: string }, creds: Creds)
    : Promise<{ channel: string; ts: string }>;                       // conversations.open + chat.postMessage
  updateAlert(channel: string, ts: string, a: { blocks: unknown[]; text: string }, creds: Creds): Promise<void>; // chat.update
  respond(responseUrl: string, text: string, ephemeral: boolean): Promise<void>;
  lookupByEmail?(email: string, creds: Creds): Promise<{ slackUserId: string } | null>;   // optional auto-link
}

interface AIProvider { /* see 05-ai.md §3 */ }

// Realtime is NOT an external integration: core/realtime/emit.ts writes `realtime_events` rows in the
// caller's tx (ADR-0003). If a push provider is added later, it goes behind this interface:
interface RealtimeFeed {
  emit(tx: Tx, msg: { topic: RealtimeTopic; ids: string[] }): Promise<void>;
  changesSince(tx: Tx, since: Date): Promise<Array<{ id: string; topic: RealtimeTopic; ids: string[]; at: Date }>>;
}
type RealtimeTopic = 'leads'|'lead'|'notifications'|'conversations'|'messages'|'payments'|'appointments'|'dashboard'|'team'|'integrations'|'ai';

interface BlobStorage {                                                // Vercel Blob
  put(key: string, bytes: Uint8Array, mime: string): Promise<{ key: string }>;   // key = `ws/<wsId>/<uuid>`
  get(key: string): Promise<ReadableStream>;                           // only via /api/media/[id] after permission check
  del(key: string): Promise<void>;
}

interface WakeScheduler {                                              // QStash
  scheduleAt(at: Date, dedupeId: string): Promise<{ messageId: string }>;  // POST /api/internal/tick at `at`
  cancel(messageId: string): Promise<void>;
}
// As built (T-008): verification is a separate TickVerifier (core/integrations/qstash/verify.ts,
// @upstash/qstash Receiver, current + next key, URL-bound, raw body).
```

The registry (`integrations/registry.ts`) maps `integration_connections.provider` to an adapter. Tests and the Judge Console swap in `Fake*` adapters through the same registry. The env flag `INTEGRATIONS_FAKE=1` is allowed **only** in tests and local dev, and boot refuses it when `VERCEL_ENV=production`.

## 2. Webhook ingress (one shape for all providers)

Routes:

| Route | Provider | Method(s) |
|---|---|---|
| `/api/webhooks/meta/[connectionKey]` | Meta WhatsApp | GET (handshake), POST. `default` = platform META_* env credentials; the workspace is found via `messaging_resolve_workspace(phone_number_id, WHATSAPP_DEFAULT_WORKSPACE_SLUG)` |
| `/api/webhooks/stripe/[connectionKey]` | Stripe | POST |
| `/api/webhooks/slack/[connectionKey]/commands` | Slack (slash command) | POST |
| `/api/webhooks/slack/[connectionKey]/interactions` | Slack (Block Kit buttons) | POST |
| `/api/integrations/google/callback` | Google OAuth redirect (not a webhook) | GET |
| `/api/internal/tick` | QStash / cron / nudge | POST |

`connectionKey` is a random 24-char token from `integration_connections.connection_key`. It's not a secret, only a routing key; authenticity always comes from the provider signature.

```ts
export async function POST(req, { params }) {
  const rawBody = await req.text();                                   // BEFORE any JSON parsing
  const conn = await resolveConnection(params.provider, params.connectionKey);   // SECURITY DEFINER lookup
  if (!conn) return new Response('not found', { status: 404 });       // still logs a rejected event with workspace_id NULL
  const adapter = registry.get(conn.provider);
  const v = adapter.verifyWebhook({ ..., rawBody }, await decrypt(conn));
  if (!v.ok) { await recordRejected(conn, v.reason, rawBody); return new Response('bad signature', { status: 401 }); } // I1.2/I2.3
  const events = adapter.parseWebhook(...);                           // may be 0..n
  const ids = await withWorkspaceTx(conn.workspaceId, tx =>
    Promise.all(events.map(e => ingest(tx, conn, e))));                // INSERT integration_events ON CONFLICT … duplicate_count+1
                                                                       // + outbox 'integration.process' only when newly inserted
  after(() => runOutboxItems(ids.filter(Boolean)));                    // F6.13: process now, not at next wake
  return new Response('ok', { status: 200 });                         // always fast, also for duplicates
}
```

- `ingest()` returns the outbox id only for **new** events. A duplicate increments `duplicate_count` and enqueues nothing (I1.8, I2.4).
- `payload_redacted` drops phone numbers beyond the last 4 digits, emails, message bodies longer than 500 chars, and anything matching `/(secret|token|key|authorization)/i`. The full body is kept only as a hash. Message bodies are stored in `messages`, not in sync history.
- Respond within ~1 s. Meta and Stripe both retry on slow or non-2xx responses.

## 3. Meta WhatsApp Cloud API (I1) — the required messaging adapter

| Topic | Implementation |
|---|---|
| Credentials | `public_config`: `phone_number_id`, `waba_id`, `graph_api_version` **(verify current version)**. `secrets_enc`: `access_token` (temporary 24 h token or system-user token), `app_secret`, `verify_token` |
| Handshake (I1.1) | GET with `hub.mode=subscribe` and `hub.verify_token` equal to the stored token → reply `hub.challenge` as plain text 200. Otherwise 403 |
| Signature (I1.2) | `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256(**raw body**, `app_secret`). Compare with `crypto.timingSafeEqual` on equal-length buffers. A mismatch or missing header → rejected event + 401 |
| Parse | `entry[].changes[].value.messages[]` (inbound) and `.statuses[]` (status). One POST may carry several of each |
| Idempotency (I1.8) | Inbound: `external_event_id = wamid`, plus `UNIQUE (connection_id, provider_message_id)` on `messages`. Status: `external_event_id = wamid + ':' + status` |
| Inbound processing (I1.5) | Outbox `integration.process` → `messaging.handleInbound`: match contact by `(workspace_id, phone_e164)`. Unknown → create contact + **intake** (03 §T1, `source_kind='whatsapp'`). Known with an open lead → attach. Upsert `conversations` and set `last_inbound_at = message time`. Insert `messages(direction='in')`. Detect language (05 §6). Media → outbox `media.download`. Then evaluate AI (05 §4) |
| Send (I1.3) | `messages` row `status='queued'` in the user's tx → outbox `message.send` → adapter → `status='sent'` + `provider_message_id`. The UI shows it immediately (optimistic) |
| Status (I1.4) | Map to `sent < delivered < read`. **Forward only**: `UPDATE … WHERE status_rank(status) < status_rank($new)`. `failed` sets `status_reason` from the error title/code and is shown with a Retry button |
| Failure (I1.7) | Temporary (5xx, timeout, 429) → retry with backoff. Permanent (e.g. recipient not in the allowed list, window closed, invalid token) → `failed` + plain reason (i18n key per known error code). Never dropped |
| Opt-out (I1.9) | `contacts.opted_out` blocks `message.send` for humans **and** AI. It's checked in the service and again in the outbox handler (defense in depth). An inbound "STOP" / "بند" / "band karo" suggests opt-out to the owner; it is not applied automatically |
| 24 h window (I1.10) | Open ⇔ `now() < last_inbound_at + 24h`. Outside the window, free text is rejected (`WINDOW_CLOSED`) in the service, and the composer switches to template picker mode using `message_templates.wa_template_name`. Templates must be pre-approved in Meta **(verify: test number ships with `hello_world`)** |
| Media (I1.11, F8.1) | Outbox `media.download`: GET the media URL with the bearer token (URLs expire quickly, **verify TTL**), stream to Blob `ws/<wsId>/<uuid>`, insert `media`, link the message. Audio → outbox `ai.transcribe` |
| Limits copy (I5.6) | "Test number reaches only registered test recipients (max ~5, **verify**)"; "Free text only within 24 h of the customer's last message"; "Access token may expire (temporary tokens last 24 h)" |

**Verified 2026-10-18 (developers.facebook.com):** Graph API latest v26.0 (2026-07-29); default in code/config `v25.0` (valid to 2028-07, `META_GRAPH_VERSION`). Send = `POST /{phone-number-id}/messages` (`messaging_product:'whatsapp'`, `type: text|template|image|audio|document`), response `messages[0].id`; webhook value = `metadata.phone_number_id`, `contacts[].profile.name`, `messages[]`, `statuses[]` (failed: `errors[0].{code,title}`); media = `GET /{media-id}` -> `{url, mime_type}` then GET url with the bearer token. Error classes (`classifyMetaError`): 190/102/401 auth; 131030 recipient not on allow-list; 131047/131049 window/engagement; 131026 undeliverable; 132xxx template; 4/17/32/613/130429/131048/131056 + 5xx temporary.

**As built (T-141/T-142/T-146):** adapter `core/integrations/meta/adapter.ts` (+ `fake.ts`: signed requests, payload builders); registry `getMessaging()`/`setMessaging()`. Pipeline `core/services/messaging-ingest.ts` (no `META_APP_SECRET` -> 503 + log, never accepts unverified); processing `core/services/messaging.ts` (`processWhatsAppEvent`, `deliverMessage`, `downloadInboundMedia`); jobs `whatsapp.send`, `media.download`, and the Meta branch of `integration.process`. A status webhook that outruns the send job's recording of the wamid throws and is retried by the outbox. `integration_events.normalized.text` is dropped once processed (no bodies in sync history). Intake hook for Lane A: `registerInboundCustomerMessageHandler(async (tx, {workspaceId, contactId|null, phone, name, text, conversationId, messageId, at}) => ({contactId?}))` in `core/services/messaging-hooks.ts`. Opt-out: an inbound STOP / band karo only sets `opt_out_suggested_at`; a human applies it (`POST /conversations/:id/opt-out`, audited `contact.opted_out`). Templates: built-in `hello_world` (en_US) plus `message_templates` rows with `wa_template_name`. Media: Vercel Blob in private mode when `BLOB_READ_WRITE_TOKEN` is set, else `media.data bytea` (<= 8 MB) so the demo works without Blob; served only through `/api/v1/media/:id` (permission + conversation visibility, `nosniff`, sandbox CSP). Known limit: Meta has no send idempotency key, so a crash between the provider accepting and us recording the wamid can duplicate a message on retry.

Twilio (optional adapter): signature `X-Twilio-Signature` (HMAC-SHA1 of URL + sorted params). Idempotency on `MessageSid`. Sandbox join phrase + ~3-day expiry in the limits copy. Build only if time allows (P2).

## 4. Stripe test mode (I2)

| Topic | Implementation |
|---|---|
| Account | Test-mode account registered under a supported country (Stripe does not onboard Pakistan, **verify**). `secrets_enc`: `secret_key` (sk_test_…), `webhook_secret` (whsec_…, per endpoint). Boot/connect check rejects `sk_live_` |
| Create (I2.1) | Service `payments.createRequest(actor, {opportunityId, amountMinor, currency, conversationId?})` → `payment_requests(status='open')` → outbox `payment.create_checkout` → Checkout Session with `metadata.payment_request_id`, `client_reference_id`, `expires_at` (Stripe allows 30 min–24 h, **verify**), success/cancel URLs under `PUBLIC_BASE_URL/pay/...` → store `provider_ref` + `url` → realtime |
| $ button (P1) | Same service called from the conversation. It then enqueues `message.send` using template `payment_link` (localized, F7.6). Outside the 24 h window → template-only path or "copy link" fallback |
| Verify (I2.3) | `stripe.webhooks.constructEvent(rawBody, sig, webhook_secret)` before any DB change. Failure → rejected event, 400 |
| Idempotency (I2.4) | `external_event_id = event.id`. Also `UNIQUE (provider_ref, kind)` on `payments`, so even a replayed different event can't double-record |
| Events handled | `checkout.session.completed` (payment_status `paid`) → `payments(kind='charge')`, request `paid`, `paid_at` · `checkout.session.async_payment_succeeded/failed` · `checkout.session.expired` → `expired` · `payment_intent.payment_failed` → `failed` with reason · `charge.refunded` → `payments(kind='refund', amount = delta of amount_refunded)`, status `refunded` / `partially_refunded`. Everything else is stored as `ignored` |
| Out-of-order | Status transitions are monotonic per request (`open → paid → (partially_)refunded`; `open → expired/failed`). A late `expired` after `paid` is ignored and logged |
| Thread + timeline (I2.2) | On paid: `messages(kind='event', author_type='system', template_key='paid')` "Paid ✓" in the linked conversation, `activities(type='payment')`, realtime `payments` + `dashboard`. The opportunity page updates without refresh |
| Collected vs expected (I2.6) | Dashboard uses `payments` only (Σ charge − Σ refund). Open requests count toward *projected* revenue |
| Traceability (I2.7) | The payment row shows opportunity, contact, `requested_by`, `provider_ref` (links to the Stripe test dashboard) |
| Card data (I2.8) | Hosted Checkout only. Card fields never touch our code. Redaction strips `payment_method_details` from stored payloads |

**As built (T-143, verified 2026-10-18):** `stripe@23.0.0` pinned to API version `2026-09-30.endive` (the SDK sends it; we never override). Checkout Session `mode=payment`, `expires_at` 30 min-24 h (verified), `client_reference_id` + `metadata.payment_request_id` on the session **and** `payment_intent_data.metadata` (so `charge.refunded`/`payment_intent.payment_failed` find the tenant). Status values are `pending` (not `open`), `paid`, `expired`, `failed`, `refunded`, `partially_refunded`; permission is `payments.request`. The test account bills **USD**: a PKR value is converted at `STRIPE_PKR_PER_USD` (default 280, demo FX) and the original stays as `display_text`. Webhook: `POST /api/webhooks/stripe/default` (platform secret `STRIPE_WEBHOOK_SECRET`) or `/<connectionKey>` (workspace connection `webhookSecret`); forged signature -> 400 + a `rejected` event; the default endpoint finds the tenant from the signed event via `payment_resolve_workspace()`. `charge.refunded` has no refund id without expansion, so the refund ledger row is keyed `<charge>:<cumulative refunded>` (idempotent). A `paid` event wins over a prior `failed`/`expired` (card retry, or a payment racing a cancel). `opportunity_id`/`contact_id` are plain uuids until Lane B2 adds the FKs; the opportunity lookup + visibility scope switch on automatically when the `opportunities` table exists. WhatsApp delivery (Lane C3) calls `payments.linkMessageText()`; no `whatsapp.send` job exists on main yet.

Local dev: `stripe listen --forward-to localhost:3000/api/webhooks/stripe/<devConnectionKey>`. Use the CLI's whsec for the dev connection. Production uses a dashboard-registered endpoint at the production domain.

## 5. Google Calendar (I3)

| Topic | Implementation |
|---|---|
| App | Google Cloud project, Calendar API enabled, OAuth consent screen in **Testing** with listed test users. Scopes: `calendar.events` + `calendar.freebusy` (or `calendar.readonly` for free/busy, **verify minimal scopes**). Client ID/secret in env (platform-level), redirect `PUBLIC_BASE_URL/api/integrations/google/callback` |
| Connect (I3.1) | `GET /api/v1/integrations/google/connect` → create `oauth_states` row (state hash, PKCE verifier encrypted, user, 10 min expiry) → redirect with `access_type=offline&prompt=consent`. Callback: validate state (single use, same user session), exchange code, encrypt tokens into the user's `integration_connections(provider='google_calendar', user_id=me)`, audit `integration.connected` |
| Tokens (I3.2) | Access token cached in `secrets_enc` with `expires_at`. Refresh when within 5 min of expiry (lazy on use + `integration.health` job). `invalid_grant` → `status='needs_reconnect'`, notify the user, show a banner. Testing-mode apps get **refresh tokens that expire after ~7 days (verify)**, so plan a fresh reconnect on demo morning (12-demo-and-ops checklist) |
| Disconnect | Revoke the token at Google (best effort), wipe secrets, `status='not_connected'`, audit |
| Free/busy (I3.4) | The booking dialog calls `GET /api/v1/calendar/:userId/availability?from&to`. The server queries freeBusy, plus our own scheduled `appointments` (covers propagation lag). Overlap → block with an explanation (or warn + explicit override if `appointments.override` is held) |
| Create (I3.3) | Service writes `appointments(status='scheduled')` + `activities` + outbox `calendar.create_event` (idempotency: event `id` derived from the appointment uuid, base32hex, so retries never duplicate) → store `provider_event_id`. Counts as a human action on the lead (03 §T10) |
| Change/cancel (I3.6) | Update/cancel via outbox; activity entries; version check on `appointments` |
| Time zones (I3.5) | Store `starts_at/ends_at` UTC + `timezone` IANA. Render in the viewer's `users.timezone` with `Intl`. Show the customer's local time in confirmations using the workspace timezone |
| Bookability (I3.7) | Admins see each employee's calendar status on the integrations/team page. Booking UI disables employees without `connected`, with the reason |
| Instant booking (I3.8, P1) | Thank-you page calls `GET /api/public/forms/:slug/slots?lead=<signed token>`. Slots are offered **only if** custody = handler, the handler is connected, the Google breaker is closed, and the call returns within 3 s. Otherwise show "a team member will arrange a time". Never expose the fallback custodian's calendar. Booking from the public page uses the same appointment service with `actor_type='system'` and the signed lead token (expires in 30 min) |
| Confirmation (I3.9, P1) | Outbox `message.send` with template `booking_confirmation` in `contacts.language` (window permitting) |

**As built (T-144, verified 2026-10-18):** plain `fetch` adapter (no googleapis dependency). Scopes `openid email calendar.events calendar.freebusy` (freeBusy accepts `calendar.freebusy`; events need `calendar.events`). Flow: `GET /api/integrations/google/start` (session, `appointments.manage`) -> `oauth_states` (sha256 state, PKCE verifier encrypted, 10 min, single use, bound to the user) -> Google (`access_type=offline&prompt=consent`) -> `GET /api/integrations/google/callback` -> encrypted `{refreshToken, accessToken, accessExpiresAt}` in the user's `integration_connections` row -> redirect to `/<locale>/appointments?calendar=connected|denied|error`. Refresh is lazy (within 5 min of expiry); `invalid_grant|invalid_client|unauthorized_client` -> `needs_reconnect`; 5 temporary failures open the per-connection breaker. Event id = the appointment uuid without dashes (valid base32hex), so retries and lease re-runs never duplicate; a 409 re-reads/reinstates the event. Conflict check = Google freeBusy (primary) UNION our own `scheduled` appointments, serialized per calendar with `pg_advisory_xact_lock`; Google down -> local-only check with `partial: true`. Register redirect URIs `http://localhost:<port>/api/integrations/google/callback` and `<PUBLIC_BASE_URL>/api/integrations/google/callback` on the OAuth client. Endpoints: `GET|DELETE /api/v1/calendar/connection`, `GET /api/v1/calendar/team`, `GET /api/v1/calendar/:userId/availability`, `GET|POST /api/v1/appointments`, `PATCH /api/v1/appointments/:id`, `POST /api/v1/appointments/:id/cancel`. Contact/opportunity/lead ids are plain uuids until Lane B2/A add the FKs; the "counts as a human action on the lead" hook (03 §T10) is not wired yet.

`oauth_states` table: `state_hash, workspace_id, user_id, code_verifier_enc, expires_at, used_at` (added to 02-data-model §8).

## 6. Slack app (I4)

Replaces the earlier chat-bot notifier (ADR-0011). **Verify all Slack API specifics (method names, scopes, payload shapes, rate-limit tiers, error codes) against the current Slack docs at build time.**

**Verified 2026-10-18 (docs.slack.dev):** signing = `v0=` + hex HMAC-SHA256 of `v0:{ts}:{raw body}`, 5 min window; slash commands and interactions are form-encoded (interactions: `payload` field holding JSON) and must be acked within 3 s; `response_url` allows 5 uses within 30 min; `conversations.open` (`im:write`, Tier 3) → `channel.id`; `chat.postMessage` (`chat:write`, ~1 msg/s/channel) → `{channel, ts}`; `chat.update` (Tier 3); HTTP 429 + `Retry-After` seconds. As built: platform-default app uses connection key `default` (`/api/webhooks/slack/default/commands|interactions`, env credentials); its breaker/last-OK live on a lazily created per-workspace `integration_connections` row (`public_config.source = platform`). Inbound rows for `default` start with `workspace_id NULL` and are attributed once the payload resolves (link code / alert id). The one-time link code is never stored in `integration_events` (only its hash).

| Topic | Implementation |
|---|---|
| App | One Slack app in a free Slack workspace, defined by the app manifest `apps/web/slack/manifest.json` (created by a build task). `pnpm slack:manifest` prints it with the prod `PUBLIC_BASE_URL` filled in, so setup is one paste in api.slack.com → "Create app from manifest" → install to workspace → copy bot token + signing secret. Bot scopes: `chat:write`, `im:write`, `commands`, `users:read`, `users:read.email`. Platform credentials: `SLACK_BOT_TOKEN` (`xoxb-…`), `SLACK_SIGNING_SECRET`, `SLACK_APP_ID`, optional `SLACK_TEAM_ID` (reject payloads from other workspaces). A workspace `integration_connections` row with provider `slack` (encrypted) may override them; same code path |
| Inbound endpoints | `POST /api/webhooks/slack/<connectionKey>/commands`: slash command `/relay` (`/relay link <code>`, `/relay help`). `POST /api/webhooks/slack/<connectionKey>/interactions`: Block Kit button clicks (form-encoded `payload` JSON). Both return 200 within 3 s; real work goes to the outbox; slow replies use `response_url` |
| Verify | On the **raw body**: compute `v0=` + hex HMAC-SHA256 of `v0:{X-Slack-Request-Timestamp}:{raw body}` with the signing secret; compare to `X-Slack-Signature` in constant time; reject if the timestamp is older than 5 minutes (replay) or the signature is missing/invalid (401, `integration_events.status='rejected'`). Optionally check `team_id` == `SLACK_TEAM_ID`. Then record idempotently in `integration_events`. Dedupe key: commands = `trigger_id`; interactions = action `trigger_id`/`action_ts` + Slack user id |
| Linking (I4.3) | Profile (`/me`) → "Connect Slack" → service creates a `slack_link_tokens` row (random one-time code, hash stored, `user_id`, `workspace_id`, 10 min expiry, single use) and shows the code. The user types `/relay link <code>` in Slack. On match: store `users.slack_user_id` + `users.slack_team_id`, open the DM with `conversations.open`, send a confirmation in the user's locale, audit. Optional convenience (P1): "Auto-link by email": `users.lookupByEmail` when the Slack email equals the Relay email, still confirmed by a DM. Unlink from `/me` clears both columns |
| Alert (I4.1, I4.2, F3.9) | Outbox `slack.send {leadId, userId, purpose, leadVersion}` → render a Block Kit message in **the recipient's locale**: lead/contact name, source, reason (assigned / escalated level / critical / fallback custody, with trace sentence), time left, link `PUBLIC_BASE_URL/<locale>/leads/<id>`. Opportunity value is included **only if** the recipient has `crm.opportunity.value.view` (F1.4, via `core/auth/mask.ts`). P1 AI brief appended when present (05 §5, never awaited > 1.5 s). Sent with `chat.postMessage` to the user's DM; the returned `ts` + channel are stored on the `slack_alerts` row so the message can be edited later |
| Timing | Escalation alerts are enqueued in the escalation tx and kicked via `after()`/tick, which comfortably meets "within the same minute". `outbox.available_at=now` |
| Acknowledge button (I4.5, P1) | Block Kit button `action_id: "lead_ack"`, `value` = signed opaque alert id (`slack_alerts.id` + HMAC). The interactions handler verifies the signature, that the Slack user is linked, **is the current owner**, and the lead is still pending → `leads.acknowledge(actor=user, via='slack', expectedOwner=user)` (T2) → `chat.update` to "Acknowledged by Ayesha at 14:03". Stale (owner changed / already acked / closed) → ephemeral reply via `response_url` ("This lead is now with Sara, nothing changed"), no state change. Both outcomes audited |
| Claim button (P1 first-to-claim) | `action_id: "lead_claim"`, same signed value → `leads.claim` (03 §T8). The loser gets "Already claimed by Hamza" (ephemeral) and the message is updated |
| Failure (I4.4) | Retries with backoff (2 s, 8 s, 30 s, 2 min, 5 min; 5 attempts) on 5xx and on 429, honoring `Retry-After`. Permanent errors (`channel_not_found`, `not_in_channel`, `account_inactive`, `invalid_auth`, `user_not_found`) mark the delivery `failed`, show the reason in-app, and appear in sync history + the integrations page for Admins (`invalid_auth` also sets the connection `needs_reconnect`; `user_not_found`/`account_inactive` clear the user's link). Users who have not linked Slack are skipped with a visible reason ("Slack not connected") |
| Limits copy | "Recipients must be members of our Slack workspace and must connect Slack in their profile before alerts reach them"; "Slack rate-limits messages (~1 msg/sec per channel; Web API methods are tiered, **verify**)". Free Slack workspace: no cost |

`slack_link_tokens` table: `token_hash, workspace_id, user_id, expires_at, used_at` (02-data-model §8). `slack_alerts` table: see 02-data-model §4.

Test double: `core/integrations/slack/fake.ts` (enabled with `INTEGRATIONS_FAKE=1`) records posted/updated messages and lets tests simulate button clicks and slash commands with correctly signed requests.

## 7. Outbox job catalogue (single source of truth)

Default retry: exponential backoff `min(2^attempt × 2 s, 10 min)` with ±20 % jitter, `max_attempts=6`, then `status='dead'` with an Admin-visible error. `ProviderError.kind='permanent'` → `failed` immediately. `'auth'` → `failed` + connection `needs_reconnect`. In-flight lease (`locked_until`) = 60 s.

| Type | Payload | Handler | Retry | `dedupe_key` |
|---|---|---|---|---|
| `integration.process` | `{eventId}` | dispatch by provider/kind → messaging / payments / slack services | default | `iev:<eventId>` |
| `message.send` | `{messageId}` | checks opt-out + window again, then adapter send; updates status | default; permanent → `failed` + reason | `msg:<messageId>` |
| `media.download` | `{messageId, providerMediaId}` | download → Blob → `media` row | 4 attempts (media URLs expire) | `media:<messageId>` |
| `slack.send` | `{leadId, userId, purpose, leadVersion}` | render Block Kit + `chat.postMessage` + `slack_alerts` row (`slack_channel`, `slack_ts`) | 5 (see §6) | `sl:<purpose>:<leadId>:<leadVersion>:<userId>` |
| `slack.update` | `{alertId, text, blocks?}` | `chat.update` (acknowledged / stale), link confirmations (`conversations.open` + post) | 3 | `slu:<interactionKey>` |
| `payment.create_checkout` | `{paymentRequestId}` | create session, store url, realtime | default | `pay:<paymentRequestId>` |
| `payment.expire_checkout` | `{paymentRequestId}` | user cancels a link | 3 | `payx:<id>` |
| `calendar.create_event` / `.update_event` / `.cancel_event` | `{appointmentId, version}` | Google call with deterministic event id | default; auth → needs_reconnect | `cal:<op>:<appointmentId>:<version>` |
| `integration.health` | `{connectionId}` | token refresh / connectivity probe / breaker half-open | 1 (re-enqueued by tick) | `health:<connId>:<minute>` |
| `lead.retry_routing` | `{teamId}` | T4 for all awaiting leads in the team | default | `rr:<teamId>:<second>` |
| `wake.schedule` | `{at}` | `WakeScheduler.scheduleAt` if earlier than `scheduler_state.next_wake_at` | 3; failure tolerated (backstop) | `wake:<epochSecond>` |
| `ai.triage` · `ai.standin_reply` · `ai.handoff` · `ai.handoff_brief` · `ai.field_fill` · `ai.transcribe` · `ai.suggest_draft` · `ai.health_explain` | see `05-ai.md` §2 | `core/ai/tasks/*` | see 05 (short timeouts, 2 attempts, then fallback) | `ai:<task>:<entityId>:<version or messageId>` |
| `audit.verify` | `{workspaceId}` | recompute chain (F4.4) for large workspaces | 1 | `auditv:<ws>:<minute>` |
| `import.csv` | `{importId}` | chunked CSV import (F2.12), resumable by row offset | default | `imp:<importId>` |

Handlers are **idempotent by construction**: they re-read state and exit if work is already done (e.g. `message.status != 'queued'`), so a lease expiry and re-run is harmless.

## 8. Shared integration rules (I5)

| ID | How we satisfy it |
|---|---|
| I5.1 Integrations page | `/[locale]/settings/integrations`: one card per provider: status chip (`not_connected`/`connected`/`error`/`needs_reconnect`), `last_ok_at`, last 5 errors (from `integration_events` with `status in (rejected, failed)`), breaker state, **AI spend today** (from `ai_usage_daily`), last tick (`job_runs`), stated limits (I5.6). Per-employee Google + Slack link status for Admins |
| I5.2 Per-workspace config | Every adapter call receives the connection resolved for **that** workspace (or user). There are no module-level clients holding credentials. Webhook routes resolve by `connectionKey` and also check that the payload's business ID (e.g. `phone_number_id`) matches the connection |
| I5.3 Secrets | AES-256-GCM `secrets_enc` (`APP_ENCRYPTION_KEY`), decrypted only inside job/service code. API returns `secrets_hint` (last 4) only. The logger has redaction paths for `*.token`, `*.secret`, `authorization`. `.env*` is gitignored except `.env.example` |
| I5.4 Sync history | Every inbound event **and** outbound call writes `integration_events` (direction, kind, status, http_status, latency_ms, reference = wamid / Stripe id / Google event id / Slack message `ts`). Viewer: `/settings/integrations/:provider/history` (permission `integrations.manage` or `audit.view`), filter by status/kind/date |
| I5.5 Resilience | Outbox retry policy (§7). Permanent errors produce a localized explanation via `integration.error.<provider>.<code>` keys with a generic fallback |
| I5.6 Limits | Static, localized "What this can and can't do" block per card (copy in §3–6 and `05-ai.md` §8) |
| I5.7 Permission + audit | Connect/change/remove requires `integrations.manage`. Audit actions: `integration.connected`, `.updated`, `.disconnected`, `.secret_rotated`, `.breaker_forced` |
| I5.8 Failure isolation | Per-connection breaker in `integration_connections.health = {state:'closed'|'open'|'half_open', failures, opened_at}`. Opens after 5 consecutive temporary failures; half-open probe after 60 s. While open, jobs reschedule without calling the provider, and the page shows "degraded". Lead engine transactions never call providers |
| I5.9 Replay (P1) | Sync history row → "Replay" (`integrations.manage`). The **stored raw body is not kept**, so replay re-fetches from the provider where supported (Stripe: `GET /v1/events/:id`, re-verified by fetching over our authenticated API key; Meta: not re-fetchable → replay re-runs `integration.process` on the stored normalized event). The path goes through `ingest()` and handlers → already-processed events report "no changes (already processed)". A row `integration_events(replay_of=<id>)` + audit `integration.event_replayed` |

To support Meta replay, `integration_events.normalized` keeps the parsed `ParsedMessagingEvent` (PII-minimal) alongside `payload_redacted`.

## 9. Realtime (polled change feed) and storage (Blob)

- Services and jobs call `realtime.emit(tx, {topic, ids})`. The `realtime_events` row commits atomically with the change, so there are no lost or phantom hints. There is no external provider.
- `GET /api/v1/changes?since=<ISO>` (session; RLS scopes it to the workspace) → `{ now, changes: [{id, topic, ids}] }`. The query uses `occurred_at > since − 5 s` (overlap, because commits can land slightly out of order), and the client dedupes by `id`. Invalidation is idempotent, so a repeat is harmless.
- The client maps topic → TanStack Query keys to invalidate. Rows older than 10 min are pruned by `runDueWork()`.
- Blob keys are random and never sent to the client. `/api/media/:id` checks session + workspace + conversation visibility (I1.6), then streams with `Cache-Control: private`.

## 10. Judge Console hooks (F10.1)

Each scenario runs real code paths against the demo workspace, and shows expected vs actual plus the DB evidence (rows/counters).

| Scenario | How |
|---|---|
| Duplicate WhatsApp webhook (I1.8) | Server builds a Meta payload for a seeded number, signs it with the real `app_secret`, POSTs it **twice** to the real webhook URL → assert 1 message, 1 lead, `duplicate_count=1` |
| Duplicate Stripe event (I2.4) | Sign a `checkout.session.completed` fixture with the endpoint secret (Stripe's documented signature scheme) and POST twice → 1 payment |
| Forged signature (I1.2, I2.3) | Same payload with a tampered byte / wrong secret → 401, `integration_events.status='rejected'`, no state change |
| Provider outage (I5.8) | Force the breaker open for Slack/OpenAI/WhatsApp → trigger an escalation → lead still escalates, in-app alert shown, job deferred, AI fallback reply used. Close the breaker → deferred jobs deliver |
| Lose the doorbell (Q5) | Cancel the scheduled QStash wake → countdown hits 0 → nudge/backstop still escalates exactly once |
| Slack stale button | Escalate a lead, then press the old alert's Acknowledge → "nothing changed" |

## 11. Environments and local testing

| | Local dev | Preview (Vercel) | Production |
|---|---|---|---|
| DB | Docker Postgres | Neon branch | Neon main |
| Webhooks | Cloudflare quick tunnel → **separate dev** Meta app/number, dev Slack app (own manifest, tunnel URL), `stripe listen` | none (don't register previews) | fixed domain registered at Meta, Stripe, Google, Slack |
| Adapters | real (dev creds) or `INTEGRATIONS_FAKE=1` | real dev creds or fakes | real |
| Wake-ups | `scripts/dev-ticker.ts` | QStash optional | QStash + cron backstop |

Integration tests use `Fake*` adapters plus **real signature fixtures** (recorded webhook bodies with known test secrets), so verification code is tested byte-for-byte.
