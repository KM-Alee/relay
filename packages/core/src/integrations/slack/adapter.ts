// Slack Notifier adapter (I4). Web API details verified against docs.slack.dev on 2026-10-18:
//  - POST https://slack.com/api/{method}, JSON body, `Authorization: Bearer xoxb-…`, `ok:false` + `error`
//  - conversations.open (im:write, Tier 3) → channel.id;  chat.postMessage (chat:write, ~1 msg/s/channel)
//    → {channel, ts};  chat.update (chat:write, Tier 3);  auth.test
//  - HTTP 429 + `Retry-After` seconds  = rate limited
//  - interactions: form-encoded `payload` JSON; slash commands: form-encoded fields; 3 s ack
//  - response_url: up to 5 uses within 30 min
import { ProviderError, type Creds, type Notifier, type RawRequest, type SlackMessage } from '../types';
import { verifySlackSignature } from './signature';

const API = 'https://slack.com/api/';

/** Slack error codes that mean the credentials are bad (connection → needs_reconnect). */
const AUTH_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'missing_scope',
]);
/** Temporary server-side / throttling codes. */
const TEMPORARY_ERRORS = new Set([
  'ratelimited',
  'rate_limited',
  'internal_error',
  'fatal_error',
  'service_unavailable',
  'request_timeout',
]);

/** Map a Slack `error` code to a ProviderError (04 §6 Failure). Exported for tests. */
export function mapSlackError(code: string, retryAfterMs?: number): ProviderError {
  if (AUTH_ERRORS.has(code)) return new ProviderError('auth', code, `slack: ${code}`);
  if (TEMPORARY_ERRORS.has(code)) return new ProviderError('temporary', code, `slack: ${code}`, retryAfterMs);
  // channel_not_found, not_in_channel, account_inactive, user_not_found, user_disabled, is_archived,
  // invalid_blocks, msg_too_long, message_not_found, cant_update_message, … never succeed on retry.
  return new ProviderError('permanent', code, `slack: ${code}`);
}

export interface SlackAdapterOptions {
  fetchImpl?: typeof fetch;
}

export function createSlackAdapter(opts: SlackAdapterOptions = {}): Notifier {
  const doFetch = opts.fetchImpl ?? fetch;

  async function call<T extends { ok: boolean; error?: string }>(
    method: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(API + method, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      throw new ProviderError('temporary', 'network', `slack ${method}: ${(err as Error).name}`);
    }
    if (res.status === 429) {
      const secs = Number(res.headers.get('retry-after'));
      throw new ProviderError(
        'temporary',
        'ratelimited',
        `slack ${method}: 429`,
        Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined,
      );
    }
    if (res.status >= 500)
      throw new ProviderError('temporary', `http_${res.status}`, `slack ${method}: ${res.status}`);
    let json: T;
    try {
      json = (await res.json()) as T;
    } catch {
      throw new ProviderError('temporary', 'bad_response', `slack ${method}: non-JSON response`);
    }
    if (!json.ok) throw mapSlackError(json.error ?? 'unknown_error');
    return json;
  }

  const botToken = (c: Creds) => {
    if (!c.botToken) throw new ProviderError('auth', 'not_authed', 'slack: bot token not configured');
    return c.botToken;
  };

  return {
    verifyRequest(req: RawRequest, creds, now) {
      if (!creds.signingSecret) return { ok: false, reason: 'no_signing_secret' };
      return verifySlackSignature(req.headers, req.rawBody, creds.signingSecret, now);
    },

    parseCommand(req) {
      const p = new URLSearchParams(req.rawBody);
      return {
        command: p.get('command') ?? '',
        text: (p.get('text') ?? '').trim(),
        teamId: p.get('team_id') ?? '',
        userId: p.get('user_id') ?? '',
        responseUrl: p.get('response_url') ?? '',
        triggerId: p.get('trigger_id') ?? '',
        apiAppId: p.get('api_app_id'),
      };
    },

    parseInteraction(req) {
      const raw = new URLSearchParams(req.rawBody).get('payload');
      if (!raw) throw new ProviderError('permanent', 'no_payload', 'slack interaction without payload');
      let j: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        j = JSON.parse(raw);
      } catch {
        throw new ProviderError('permanent', 'bad_payload', 'slack interaction payload is not JSON');
      }
      const a = Array.isArray(j.actions) ? j.actions[0] : null;
      return {
        type: String(j.type ?? ''),
        teamId: j.team?.id ?? j.user?.team_id ?? null,
        userId: String(j.user?.id ?? ''),
        triggerId: String(j.trigger_id ?? ''),
        responseUrl: j.response_url ?? null,
        apiAppId: j.api_app_id ?? null,
        channelId: j.channel?.id ?? j.container?.channel_id ?? null,
        messageTs: j.message?.ts ?? j.container?.message_ts ?? null,
        action: a
          ? {
              actionId: String(a.action_id ?? ''),
              value: String(a.value ?? ''),
              actionTs: String(a.action_ts ?? ''),
            }
          : null,
      };
    },

    async sendAlert(slackUserId, msg: SlackMessage, creds) {
      const token = botToken(creds);
      const open = await call<{ ok: boolean; error?: string; channel?: { id: string } }>(
        'conversations.open',
        token,
        { users: slackUserId },
      );
      const channel = open.channel?.id;
      if (!channel)
        throw new ProviderError('temporary', 'no_channel', 'conversations.open returned no channel');
      const posted = await call<{ ok: boolean; error?: string; channel?: string; ts?: string }>(
        'chat.postMessage',
        token,
        { channel, text: msg.text, blocks: msg.blocks, unfurl_links: false, unfurl_media: false },
      );
      if (!posted.ts) throw new ProviderError('temporary', 'no_ts', 'chat.postMessage returned no ts');
      return { channel: posted.channel ?? channel, ts: posted.ts };
    },

    async updateAlert(channel, ts, msg, creds) {
      await call('chat.update', botToken(creds), { channel, ts, text: msg.text, blocks: msg.blocks });
    },

    async respond(responseUrl, text) {
      // Only ever Slack's own host (response_url comes from a SIGNED payload, but be strict anyway).
      const u = new URL(responseUrl);
      if (u.protocol !== 'https:' || !/(^|\.)slack\.com$/.test(u.hostname)) {
        throw new ProviderError('permanent', 'bad_response_url', 'response_url is not a slack.com URL');
      }
      let res: Response;
      try {
        res = await doFetch(responseUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new ProviderError('temporary', 'network', 'slack response_url unreachable');
      }
      if (res.status === 429 || res.status >= 500) throw new ProviderError('temporary', `http_${res.status}`);
      if (!res.ok) throw new ProviderError('permanent', `http_${res.status}`);
    },

    async authTest(creds) {
      const r = await call<{ ok: boolean; error?: string; team_id?: string; user_id?: string }>(
        'auth.test',
        botToken(creds),
        {},
      );
      return { teamId: r.team_id ?? '', botUserId: r.user_id ?? '' };
    },
  };
}
