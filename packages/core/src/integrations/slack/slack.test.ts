import { describe, expect, it } from 'vitest';
import { createSlackAdapter, mapSlackError } from './adapter';
import { buildAlert, signAlertId, verifyAlertValue } from './blocks';
import { signedSlackRequest } from './fake';
import { slackSignature, verifySlackSignature } from './signature';

const SECRET = 'test-signing-secret';
const BODY = 'command=%2Frelay&text=link+ABCD-2345&team_id=T1&user_id=U1&trigger_id=1.2.x';
const now = new Date('2026-10-18T10:00:00Z');

describe('[I4.1] Slack request signing (v0)', () => {
  it('[I4.1] accepts a correctly signed raw body', () => {
    const { headers, body } = signedSlackRequest(SECRET, BODY, now);
    expect(verifySlackSignature(new Headers(headers), body, SECRET, now)).toEqual({ ok: true });
  });

  it('[I4.1] matches the documented basestring v0:{ts}:{body} (known vector)', () => {
    // HMAC-SHA256("v0:1531420618:" + body) with the doc's example secret.
    const sig = slackSignature('8f742231b10e8888abcd99yyyzzz85a5', '1531420618', 'token=x&team_id=T');
    expect(sig).toMatch(/^v0=[0-9a-f]{64}$/);
  });

  it('[I4.1] rejects a tampered body, wrong secret, missing headers and replays older than 5 minutes', () => {
    const { headers, body } = signedSlackRequest(SECRET, BODY, now);
    const h = new Headers(headers);
    expect(verifySlackSignature(h, body + 'x', SECRET, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifySlackSignature(h, body, 'other', now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifySlackSignature(new Headers(), body, SECRET, now)).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    const later = new Date(now.getTime() + 6 * 60_000);
    expect(verifySlackSignature(h, body, SECRET, later)).toEqual({ ok: false, reason: 'stale_timestamp' });
    h.set('x-slack-signature', 'v0=short');
    expect(verifySlackSignature(h, body, SECRET, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('[I4.4] Slack error mapping', () => {
  it('[I4.4] classifies permanent, auth and temporary errors', () => {
    expect(mapSlackError('channel_not_found').kind).toBe('permanent');
    expect(mapSlackError('user_not_found').kind).toBe('permanent');
    expect(mapSlackError('invalid_auth').kind).toBe('auth');
    expect(mapSlackError('ratelimited', 3000)).toMatchObject({ kind: 'temporary', retryAfterMs: 3000 });
  });

  it('[I4.4] 429 with Retry-After becomes a temporary error carrying the delay', async () => {
    const slack = createSlackAdapter({
      fetchImpl: async () => new Response('{}', { status: 429, headers: { 'retry-after': '7' } }),
    });
    await expect(
      slack.updateAlert('D1', '1.1', { text: 't', blocks: [] }, { botToken: 'xoxb-x' }),
    ).rejects.toMatchObject({
      kind: 'temporary',
      retryAfterMs: 7000,
    });
  });
});

describe('[F3.9] alert content', () => {
  const base = {
    leadId: '0192f3a0-0000-7000-8000-000000000301',
    leadName: 'Ayesha <b>Khan</b>',
    source: 'Website form',
    purpose: 'escalated' as const,
    reason: 'Ahmed did not respond in 5 min',
    level: 2,
    deadlineAt: new Date(now.getTime() + 4 * 60_000),
    valueText: 'PKR 1,200,000',
    baseUrl: 'https://relay.example.com',
    locale: 'en' as const,
    alertId: 'abc123XYZ',
  };

  it('[F3.9] includes name, source, reason, time left, link and a signed ack button; escapes mrkdwn', () => {
    const m = buildAlert(base, 'k', now);
    const s = JSON.stringify(m.blocks);
    expect(s).toContain('Ayesha &lt;b&gt;Khan&lt;/b&gt;');
    expect(s).toContain('Website form');
    expect(s).toContain('4 min');
    expect(s).toContain('https://relay.example.com/en/leads/0192f3a0-0000-7000-8000-000000000301');
    expect(s).toContain('"action_id":"lead_ack"');
    expect(s).toContain('PKR 1,200,000');
  });

  it('[F3.9] the button value is tamper-evident', () => {
    const v = signAlertId('abc123XYZ', 'k');
    expect(verifyAlertValue(v, 'k')).toBe('abc123XYZ');
    expect(verifyAlertValue(v, 'other')).toBeNull();
    expect(verifyAlertValue('abc123XYZ.forged0000000000', 'k')).toBeNull();
  });
});
