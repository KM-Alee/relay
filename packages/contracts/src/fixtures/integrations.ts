// Fixture builders for integrations contracts (13 §4). Owner: Lane C. Pattern: ./users.ts.
// Deterministic and schema-valid. NO secrets, ever: only hints and booleans (I5.3).
import {
  PROVIDER_FIELDS,
  type IntegrationCardDto,
  type IntegrationConnectionDto,
  type IntegrationEventDto,
  type IntegrationProvider,
  type IntegrationsListResponse,
  type SlackLinkCode,
} from '../api/integrations';

export const FIXTURE_CONNECTION_ID = '0192f3a0-0000-7000-8000-000000000b01';
export const FIXTURE_EVENT_ID = '0192f3a0-0000-7000-8000-000000000b11';
export const FIXTURE_CONNECTION_KEY = 'k3v9q2m7x1c8w5z4t6y0h2jd';

export function buildIntegrationConnection(
  overrides: Partial<IntegrationConnectionDto> = {},
): IntegrationConnectionDto {
  return {
    id: FIXTURE_CONNECTION_ID,
    provider: 'meta_whatsapp',
    status: 'connected',
    userId: null,
    publicConfig: { phoneNumberId: '1234567890' },
    secretFieldsSet: ['accessToken', 'appSecret', 'verifyToken'],
    secretsHint: '••••a1b2',
    lastOkAt: '2026-10-18T10:00:00.000Z',
    lastErrorAt: null,
    lastError: null,
    health: { state: 'closed', failures: 0, openedAt: null },
    connectionKey: FIXTURE_CONNECTION_KEY,
    version: 1,
    ...overrides,
  };
}

export function buildIntegrationEvent(overrides: Partial<IntegrationEventDto> = {}): IntegrationEventDto {
  return {
    id: FIXTURE_EVENT_ID,
    provider: 'slack',
    direction: 'in',
    kind: 'slack.command',
    status: 'rejected',
    duplicateCount: 0,
    httpStatus: 401,
    latencyMs: 3,
    reference: null,
    payloadRedacted: { reason: 'bad_signature' },
    error: 'bad_signature',
    createdAt: '2026-10-18T10:00:00.000Z',
    processedAt: null,
    ...overrides,
  };
}

export function buildIntegrationCard(
  provider: IntegrationProvider,
  overrides: Partial<IntegrationCardDto> = {},
): IntegrationCardDto {
  const f = PROVIDER_FIELDS[provider];
  return {
    provider,
    connection: null,
    platformDefault: false,
    status: 'not_connected',
    connectable: f.connectable,
    secretFields: [...f.secret],
    publicFields: [...f.public],
    webhookUrls: [],
    recentErrors: [],
    deadJobs: 0,
    ...overrides,
  };
}

export function buildIntegrationsList(
  overrides: Partial<IntegrationsListResponse> = {},
): IntegrationsListResponse {
  return {
    cards: [
      buildIntegrationCard('meta_whatsapp', {
        connection: buildIntegrationConnection(),
        status: 'connected',
        webhookUrls: [
          {
            label: 'Webhook',
            url: `https://relay.example.com/api/webhooks/meta_whatsapp/${FIXTURE_CONNECTION_KEY}`,
          },
        ],
      }),
      buildIntegrationCard('stripe'),
      buildIntegrationCard('google_calendar'),
      buildIntegrationCard('slack', {
        platformDefault: true,
        status: 'connected',
        webhookUrls: [
          { label: 'commands', url: 'https://relay.example.com/api/webhooks/slack/default/commands' },
          { label: 'interactions', url: 'https://relay.example.com/api/webhooks/slack/default/interactions' },
        ],
        recentErrors: [buildIntegrationEvent()],
      }),
      buildIntegrationCard('openai'),
    ],
    slack: { linkedUsers: 2, totalUsers: 5 },
    lastTickAt: '2026-10-18T10:00:00.000Z',
    ...overrides,
  };
}

export function buildSlackLinkCode(overrides: Partial<SlackLinkCode> = {}): SlackLinkCode {
  return {
    code: 'K7Q2-9XMD',
    expiresAt: '2026-10-18T10:10:00.000Z',
    command: '/relay link K7Q2-9XMD',
    ...overrides,
  };
}

/** One entry per endpoint in integrationsEndpoints, used by the api-client in fixture mode. */
export const integrationsFixtures = {
  list: () => buildIntegrationsList(),
  connect: () => buildIntegrationConnection(),
  disconnect: () => ({ ok: true as const }),
  breaker: () =>
    buildIntegrationConnection({
      health: { state: 'open', failures: 5, openedAt: '2026-10-18T10:00:00.000Z' },
    }),
  events: () => ({ events: [buildIntegrationEvent()], nextBefore: null }),
  slackLinkStatus: () => ({ linked: false, available: true }),
  slackLinkCreate: () => buildSlackLinkCode(),
  slackLinkDelete: () => ({ ok: true as const }),
};
