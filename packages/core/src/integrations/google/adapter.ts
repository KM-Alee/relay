// Google Calendar adapter (OAuth 2.0 web-server flow + PKCE, Calendar v3 REST over fetch; docs/04-integrations.md §5).
// Verified 2026-10-18 against developers.google.com: freeBusy `POST /calendar/v3/freeBusy` accepts scope
// calendar.freebusy; events.insert/patch/delete need calendar.events; token/revoke at oauth2.googleapis.com.
// Scopes requested: openid, email (display only), calendar.events, calendar.freebusy (minimal for I3.3/I3.4).
// Thin translator: no DB, no business rules. Tokens are passed in by the caller and never logged.
import { config } from '../../config';
import { ProviderError, type CalEvent, type CalendarProvider, type OAuthTokens } from '../types';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const;

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 8_000;

export function googleConfigured(): boolean {
  const g = config.google;
  return !!(g.GOOGLE_CLIENT_ID && g.GOOGLE_CLIENT_SECRET);
}

function creds(): { id: string; secret: string } {
  const g = config.google;
  if (!g.GOOGLE_CLIENT_ID || !g.GOOGLE_CLIENT_SECRET) {
    throw new ProviderError('permanent', 'google_not_configured', 'Google OAuth client is not configured');
  }
  return { id: g.GOOGLE_CLIENT_ID, secret: g.GOOGLE_CLIENT_SECRET };
}

const scrub = (s: string) => s.replace(/(ya29\.|1\/\/)[A-Za-z0-9._-]+/g, '[redacted]').slice(0, 300);

async function http(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderError('temporary', 'google_unreachable', scrub(String((err as Error).message)));
  }
}

/** Calendar API status -> outbox policy: 401 -> auth, 429/5xx -> temporary, other 4xx -> permanent. */
function fail(res: Response, body: string): ProviderError {
  let reason = '';
  try {
    const j = JSON.parse(body) as {
      error?: { errors?: Array<{ reason?: string }>; message?: string; status?: string };
    };
    reason = j.error?.errors?.[0]?.reason ?? j.error?.status ?? j.error?.message ?? '';
  } catch {
    /* non-JSON error body */
  }
  const code = `google_${res.status}${reason ? `_${reason}` : ''}`;
  if (res.status === 401) return new ProviderError('auth', code, 'Google rejected the access token');
  if (res.status === 403 && /insufficient|forbidden|authError/i.test(reason))
    return new ProviderError('auth', code, 'Calendar permission was revoked');
  if (res.status === 429 || (res.status === 403 && /rateLimit|quota/i.test(reason))) {
    const ra = Number(res.headers.get('retry-after'));
    return new ProviderError(
      'temporary',
      code,
      'Google rate limit',
      Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined,
    );
  }
  if (res.status >= 500) return new ProviderError('temporary', code, 'Google error');
  return new ProviderError('permanent', code, scrub(reason || body));
}

async function tokenCall(params: Record<string, string>): Promise<OAuthTokens> {
  const { id, secret } = creds();
  const res = await http(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const text = await res.text();
  if (!res.ok) {
    let err = '';
    try {
      err = (JSON.parse(text) as { error?: string }).error ?? '';
    } catch {
      /* ignore */
    }
    // invalid_grant: refresh token revoked/expired (Testing-mode apps: ~7 days) -> reconnect (I3.2).
    if (err === 'invalid_grant' || err === 'invalid_client' || err === 'unauthorized_client')
      throw new ProviderError('auth', `google_${err}`, 'Google connection needs to be re-authorized');
    if (res.status >= 500 || res.status === 429)
      throw new ProviderError('temporary', `google_token_${res.status}`);
    throw new ProviderError('permanent', `google_token_${err || res.status}`, scrub(text));
  }
  const j = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  };
  return {
    accessToken: j.access_token,
    ...(j.refresh_token ? { refreshToken: j.refresh_token } : {}),
    expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
    ...(j.id_token ? { email: emailFromIdToken(j.id_token) } : {}),
  };
}

/** The id_token comes straight from Google's token endpoint over TLS; we only read the display email. */
function emailFromIdToken(jwt: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      email?: string;
    };
    return payload.email;
  } catch {
    return undefined;
  }
}

function eventBody(e: CalEvent) {
  return {
    summary: e.title,
    ...(e.description ? { description: e.description } : {}),
    start: { dateTime: e.start.toISOString(), timeZone: e.timeZone },
    end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
    ...(e.attendeeEmail ? { attendees: [{ email: e.attendeeEmail }] } : {}),
  };
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

export function createGoogleAdapter(): CalendarProvider {
  return {
    authUrl({ state, codeChallenge, redirectUri, loginHint }) {
      const u = new URL(AUTH);
      u.search = new URLSearchParams({
        client_id: creds().id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // Offline access + forced consent so Google always returns a refresh token (I3.1/I3.2).
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();
      return u.toString();
    },

    exchangeCode: ({ code, codeVerifier, redirectUri }) =>
      tokenCall({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),

    refresh: (refreshToken) => tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken }),

    async revoke(token) {
      const res = await http(REVOKE, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
      if (!res.ok && res.status !== 400) throw fail(res, await res.text()); // 400 = already revoked
    },

    async freeBusy(accessToken, from, to) {
      const res = await http(`${API}/freeBusy`, {
        method: 'POST',
        headers: bearer(accessToken),
        body: JSON.stringify({
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          items: [{ id: 'primary' }],
        }),
      });
      const text = await res.text();
      if (!res.ok) throw fail(res, text);
      const j = JSON.parse(text) as {
        calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>;
      };
      const cal = j.calendars?.primary;
      if (cal?.errors?.length) throw new ProviderError('temporary', 'google_freebusy_calendar_error');
      return (cal?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    },

    async createEvent(accessToken, e) {
      const q = e.attendeeEmail ? '?sendUpdates=all' : '';
      const res = await http(`${API}/calendars/primary/events${q}`, {
        method: 'POST',
        headers: bearer(accessToken),
        body: JSON.stringify({ id: e.eventId, ...eventBody(e) }),
      });
      const text = await res.text();
      if (res.status === 409) {
        // Same deterministic id: a previous attempt already created it (retry after a lost response).
        const got = await http(`${API}/calendars/primary/events/${e.eventId}`, {
          headers: bearer(accessToken),
        });
        const gt = await got.text();
        if (!got.ok) throw fail(got, gt);
        const g = JSON.parse(gt) as { id: string; htmlLink?: string; status?: string };
        if (g.status === 'cancelled') {
          // Previously deleted: reinstate it with the new details.
          const re = await http(`${API}/calendars/primary/events/${e.eventId}`, {
            method: 'PATCH',
            headers: bearer(accessToken),
            body: JSON.stringify({ status: 'confirmed', ...eventBody(e) }),
          });
          const rt = await re.text();
          if (!re.ok) throw fail(re, rt);
          const r = JSON.parse(rt) as { id: string; htmlLink?: string };
          return { providerEventId: r.id, htmlLink: r.htmlLink ?? '' };
        }
        return { providerEventId: g.id, htmlLink: g.htmlLink ?? '' };
      }
      if (!res.ok) throw fail(res, text);
      const j = JSON.parse(text) as { id: string; htmlLink?: string };
      return { providerEventId: j.id, htmlLink: j.htmlLink ?? '' };
    },

    async updateEvent(accessToken, providerEventId, e) {
      const res = await http(
        `${API}/calendars/primary/events/${encodeURIComponent(providerEventId)}?sendUpdates=${e.attendeeEmail ? 'all' : 'none'}`,
        {
          method: 'PATCH',
          headers: bearer(accessToken),
          body: JSON.stringify(eventBody(e)),
        },
      );
      const text = await res.text();
      if (!res.ok) throw fail(res, text);
      return { htmlLink: (JSON.parse(text) as { htmlLink?: string }).htmlLink ?? '' };
    },

    async cancelEvent(accessToken, providerEventId) {
      const res = await http(
        `${API}/calendars/primary/events/${encodeURIComponent(providerEventId)}?sendUpdates=none`,
        {
          method: 'DELETE',
          headers: bearer(accessToken),
        },
      );
      // 404/410: already gone, which is the desired end state.
      if (!res.ok && res.status !== 404 && res.status !== 410) throw fail(res, await res.text());
    },
  };
}
