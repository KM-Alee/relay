// Fake Slack adapter for tests, the Judge Console and INTEGRATIONS_FAKE=1 (13 §5). Records what would
// have been sent and can mint correctly SIGNED requests, so verification is exercised byte-for-byte.
import { createSlackAdapter } from './adapter';
import { slackSignature } from './signature';
import type { Notifier, SlackMessage } from '../types';

export interface FakeSlack extends Notifier {
  posted: Array<{ slackUserId: string; channel: string; ts: string; msg: SlackMessage }>;
  updated: Array<{ channel: string; ts: string; msg: SlackMessage }>;
  responses: Array<{ responseUrl: string; text: string }>;
  /** Next sendAlert/updateAlert throws this (then clears). */
  failNext: Error | null;
}

export function createFakeSlack(): FakeSlack {
  const real = createSlackAdapter(); // reuse signature + parsing
  let n = 0;
  const f: FakeSlack = {
    ...real,
    posted: [],
    updated: [],
    responses: [],
    failNext: null,
    async sendAlert(slackUserId, msg) {
      if (f.failNext) {
        const e = f.failNext;
        f.failNext = null;
        throw e;
      }
      n += 1;
      const r = { channel: `D${String(n).padStart(8, '0')}`, ts: `${1_700_000_000 + n}.000100` };
      f.posted.push({ slackUserId, ...r, msg });
      return r;
    },
    async updateAlert(channel, ts, msg) {
      if (f.failNext) {
        const e = f.failNext;
        f.failNext = null;
        throw e;
      }
      f.updated.push({ channel, ts, msg });
    },
    async respond(responseUrl, text) {
      f.responses.push({ responseUrl, text });
    },
    async authTest() {
      return { teamId: 'TFAKE', botUserId: 'UBOT' };
    },
  };
  return f;
}

/** Build a signed Slack request (headers + raw body) for tests / Judge Console. */
export function signedSlackRequest(
  signingSecret: string,
  rawBody: string,
  now: Date = new Date(),
): { headers: Record<string, string>; body: string } {
  const ts = String(Math.floor(now.getTime() / 1000));
  return {
    body: rawBody,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': slackSignature(signingSecret, ts, rawBody),
    },
  };
}
