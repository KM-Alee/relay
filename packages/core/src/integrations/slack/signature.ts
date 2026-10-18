// Slack request signing, verified against https://docs.slack.dev/authentication/verifying-requests-from-slack/
// (checked 2026-10-18): basestring `v0:{X-Slack-Request-Timestamp}:{raw body}`, HMAC-SHA256 with the
// signing secret, hex digest prefixed `v0=`, compared to `X-Slack-Signature` in constant time;
// reject timestamps more than 5 minutes from now (replay). Always run on the RAW body.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SLACK_MAX_SKEW_SECONDS = 300;

export function slackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  return 'v0=' + createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
}

export type SlackVerifyResult = { ok: true } | { ok: false; reason: string };

export function verifySlackSignature(
  headers: Headers,
  rawBody: string,
  signingSecret: string,
  now: Date = new Date(),
): SlackVerifyResult {
  const ts = headers.get('x-slack-request-timestamp');
  const sig = headers.get('x-slack-signature');
  if (!ts || !sig) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > SLACK_MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const expected = Buffer.from(slackSignature(signingSecret, ts, rawBody));
  const got = Buffer.from(sig);
  // timingSafeEqual throws on length mismatch: compare lengths first (length is not secret).
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}
