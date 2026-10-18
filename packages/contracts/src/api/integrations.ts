// integrations API contracts: Zod request/response schemas + endpoint descriptors (docs/11-api.md). Owner: Lane C.
// Covers T-140 (connections, sync history, breaker) and T-145 (Slack linking from /me).
// SECRETS NEVER APPEAR IN ANY RESPONSE (I5.3): the DTOs expose `secretsHint` (last 4) and booleans only.
import { z } from 'zod';
import { endpoint } from './endpoint';

export const INTEGRATION_PROVIDERS = [
  'meta_whatsapp',
  'twilio_whatsapp',
  'stripe',
  'google_calendar',
  'slack',
  'openai',
] as const;
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

export const INTEGRATION_STATUSES = ['not_connected', 'connected', 'error', 'needs_reconnect'] as const;
export const integrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export const breakerStateSchema = z.enum(['closed', 'open', 'half_open']);
export type BreakerState = z.infer<typeof breakerStateSchema>;

/**
 * What a workspace admin must/may enter per provider. Field NAMES only (the UI renders a form from
 * this; the server validates against it). `secret` fields are write-only: never echoed back.
 * `oauth` providers (Google) connect through their own consent flow, not through /connect.
 */
export const PROVIDER_FIELDS = {
  slack: {
    connectable: true,
    secret: ['botToken', 'signingSecret'],
    public: ['appId', 'teamId'],
    requiredPublic: [],
  },
  meta_whatsapp: {
    connectable: true,
    secret: ['accessToken', 'appSecret', 'verifyToken'],
    public: ['phoneNumberId', 'wabaId'],
    requiredPublic: ['phoneNumberId'],
  },
  stripe: {
    connectable: true,
    secret: ['secretKey', 'webhookSecret'],
    public: [],
    requiredPublic: [],
  },
  openai: { connectable: true, secret: ['apiKey'], public: [], requiredPublic: [] },
  google_calendar: { connectable: false, secret: [], public: [], requiredPublic: [] },
  twilio_whatsapp: { connectable: false, secret: [], public: [], requiredPublic: [] },
} as const satisfies Record<
  IntegrationProvider,
  {
    connectable: boolean;
    secret: readonly string[];
    public: readonly string[];
    requiredPublic: readonly string[];
  }
>;

export const breakerHealthSchema = z.object({
  state: breakerStateSchema,
  failures: z.number().int().nonnegative(),
  openedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type BreakerHealth = z.infer<typeof breakerHealthSchema>;

export const integrationConnectionDto = z.object({
  id: z.uuid(),
  provider: integrationProviderSchema,
  status: integrationStatusSchema,
  /** Set for per-employee connections (Google Calendar); null for workspace-wide. */
  userId: z.uuid().nullable(),
  /** Non-secret configuration (phone number id, Slack team id, …). */
  publicConfig: z.record(z.string(), z.string()),
  /** Names of the secret fields that are stored (values are never returned). */
  secretFieldsSet: z.array(z.string()),
  /** Last 4 characters of the primary secret, for recognition only. */
  secretsHint: z.string().nullable(),
  lastOkAt: z.iso.datetime({ offset: true }).nullable(),
  lastErrorAt: z.iso.datetime({ offset: true }).nullable(),
  lastError: z.string().nullable(),
  health: breakerHealthSchema,
  /** Routing token for webhook URLs. Not a secret (authenticity comes from the signature). */
  connectionKey: z.string(),
  version: z.number().int().nonnegative(),
});
export type IntegrationConnectionDto = z.infer<typeof integrationConnectionDto>;

export const integrationEventStatusSchema = z.enum([
  'received',
  'processing',
  'processed',
  'rejected',
  'failed',
  'ignored',
]);
export type IntegrationEventStatus = z.infer<typeof integrationEventStatusSchema>;

export const integrationEventDto = z.object({
  id: z.uuid(),
  provider: integrationProviderSchema,
  direction: z.enum(['in', 'out']),
  kind: z.string(),
  status: integrationEventStatusSchema,
  duplicateCount: z.number().int().nonnegative(),
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  reference: z.string().nullable(),
  /** Redacted, size-capped summary (04 §2). Never the raw body. */
  payloadRedacted: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  processedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type IntegrationEventDto = z.infer<typeof integrationEventDto>;

/** One card on the integrations page (I5.1). */
export const integrationCardDto = z.object({
  provider: integrationProviderSchema,
  /** The workspace-level connection, or null when only platform defaults (env) or nothing exist. */
  connection: integrationConnectionDto.nullable(),
  /** True when the platform's env credentials cover this provider (Slack default connection). */
  platformDefault: z.boolean(),
  /** Effective status shown on the chip (a platform default counts as connected). */
  status: integrationStatusSchema,
  connectable: z.boolean(),
  secretFields: z.array(z.string()),
  publicFields: z.array(z.string()),
  /** Webhook URLs to paste into the provider console (absolute, built from PUBLIC_BASE_URL). */
  webhookUrls: z.array(z.object({ label: z.string(), url: z.string() })),
  /** Last 5 rejected/failed events for this provider (I5.1). */
  recentErrors: z.array(integrationEventDto),
  /** Outbox deliveries in `failed`/`dead` for this provider (visible failures, I4.4). */
  deadJobs: z.number().int().nonnegative(),
});
export type IntegrationCardDto = z.infer<typeof integrationCardDto>;

export const integrationsListResponse = z.object({
  cards: z.array(integrationCardDto),
  /** Slack link coverage for Admins (I5.1 "per-employee Slack link status"). */
  slack: z.object({
    linkedUsers: z.number().int().nonnegative(),
    totalUsers: z.number().int().nonnegative(),
  }),
  /** Last tick heartbeat (job_runs), null until Lane A's tick has run. */
  lastTickAt: z.iso.datetime({ offset: true }).nullable(),
});
export type IntegrationsListResponse = z.infer<typeof integrationsListResponse>;

export const providerParams = z.object({ provider: integrationProviderSchema });

export const connectIntegrationInput = z.object({
  /** Secret values by field name (see PROVIDER_FIELDS). Omit a field on update to keep it. */
  secrets: z.record(z.string(), z.string().min(1).max(4096)).default({}),
  publicConfig: z.record(z.string(), z.string().max(512)).default({}),
});
export type ConnectIntegrationInput = z.input<typeof connectIntegrationInput>;

export const forceBreakerInput = z.object({ state: z.enum(['open', 'closed']) });

export const integrationEventsQuery = z.object({
  provider: integrationProviderSchema.optional(),
  status: integrationEventStatusSchema.optional(),
  kind: z.string().max(64).optional(),
  /** Cursor: ISO timestamp of the last row's createdAt. */
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const integrationEventsResponse = z.object({
  events: z.array(integrationEventDto),
  nextBefore: z.iso.datetime({ offset: true }).nullable(),
});

// ── Slack linking from the profile (I4.3) ──────────────────────────────
export const slackLinkStatus = z.object({
  linked: z.boolean(),
  /** Slack workspace configured at all (platform default or workspace connection)? */
  available: z.boolean(),
});
export const slackLinkCode = z.object({
  /** One-time code, shown ONCE. The DB stores only its hash. */
  code: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  /** What to type in Slack. */
  command: z.string(),
});
export type SlackLinkCode = z.infer<typeof slackLinkCode>;

export const integrationsEndpoints = {
  /** GET /api/v1/integrations: cards for the page (integrations.view). */
  list: endpoint({ method: 'GET', path: '/api/v1/integrations', response: integrationsListResponse }),
  /** POST /api/v1/integrations/:provider/connect: connect or rotate secrets (integrations.manage). */
  connect: endpoint({
    method: 'POST',
    path: '/api/v1/integrations/:provider/connect',
    params: providerParams,
    body: connectIntegrationInput,
    response: integrationConnectionDto,
  }),
  /** DELETE /api/v1/integrations/:provider: disconnect, secrets wiped (integrations.manage). */
  disconnect: endpoint({
    method: 'DELETE',
    path: '/api/v1/integrations/:provider',
    params: providerParams,
    response: z.object({ ok: z.literal(true) }),
  }),
  /** POST /api/v1/integrations/:provider/breaker: force the circuit open/closed (Judge Console, I5.8). */
  breaker: endpoint({
    method: 'POST',
    path: '/api/v1/integrations/:provider/breaker',
    params: providerParams,
    body: forceBreakerInput,
    response: integrationConnectionDto,
  }),
  /** GET /api/v1/integration-events: sync history (integrations.view). */
  events: endpoint({
    method: 'GET',
    path: '/api/v1/integration-events',
    query: integrationEventsQuery,
    response: integrationEventsResponse,
  }),
  /** GET /api/v1/me/slack-link: is my Slack linked? */
  slackLinkStatus: endpoint({ method: 'GET', path: '/api/v1/me/slack-link', response: slackLinkStatus }),
  /** POST /api/v1/me/slack-link: mint a one-time code to type as `/relay link <code>`. */
  slackLinkCreate: endpoint({ method: 'POST', path: '/api/v1/me/slack-link', response: slackLinkCode }),
  /** DELETE /api/v1/me/slack-link: unlink. */
  slackLinkDelete: endpoint({
    method: 'DELETE',
    path: '/api/v1/me/slack-link',
    response: z.object({ ok: z.literal(true) }),
  }),
} as const;
