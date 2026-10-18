// I4.2 / rubric 8: a forged or replayed Slack request is rejected (401) and acted on by nobody.
import { ingestSlack } from '../../integrations-ingest';
import { nonce, rejectedSince, slackHeaders, webhookTarget } from '../helpers';
import { fail, pass, pending, type JudgeScenario } from '../types';

export const slackForged: JudgeScenario = {
  id: 'slack-forged',
  criterion: 8,
  reqs: ['I4.2', 'I5.2'],
  expected: 'Wrong signature, missing signature and a >5 minute old timestamp: all 401',
  async run({ actor, step }) {
    const t = await webhookTarget(actor.workspaceId, 'slack');
    if (!t.ok) return pending(t.why);
    const rawBody = `command=%2Frelay&text=link+JUDGE${nonce()}&trigger_id=judge.${nonce()}&team_id=T0JUDGE&user_id=U0JUDGE`;
    const started = new Date();
    const send = (headers: Headers) =>
      ingestSlack({
        connectionKey: t.connectionKey,
        endpoint: 'commands',
        req: {
          method: 'POST',
          url: new URL(`https://relay.invalid/api/webhooks/slack/${t.connectionKey}/commands`),
          headers,
          rawBody,
        },
        ip: 'judge-console',
      });
    const now = Math.floor(Date.now() / 1000);
    const wrong = await send(slackHeaders('forged_by_judge', rawBody));
    step('Signed with the wrong signing secret', wrong.status === 401, `HTTP ${wrong.status}`);
    const none = await send(new Headers({ 'content-type': 'application/x-www-form-urlencoded' }));
    step('No signature headers', none.status === 401, `HTTP ${none.status}`);
    const stale = await send(slackHeaders(t.secret, rawBody, now - 3600));
    step('Correctly signed but one hour old (replay)', stale.status === 401, `HTTP ${stale.status}`);
    const rejected = await rejectedSince(actor.workspaceId, 'slack', started);
    step('Rejections recorded in sync history', rejected >= 1, `${rejected} rejected row(s)`);
    const ok = wrong.status === 401 && none.status === 401 && stale.status === 401 && rejected >= 1;
    return (ok ? pass : fail)(
      `wrong secret ${wrong.status}, no signature ${none.status}, replayed ${stale.status}; rejected rows logged: ${rejected}`,
      [{ key: 'syncHistory', href: '/settings/integrations' }],
    );
  },
};
