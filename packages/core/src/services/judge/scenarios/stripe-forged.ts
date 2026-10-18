// I2.3 / rubric 6: a forged Stripe webhook is rejected (400) and nothing is recorded as an event.
import { ingestStripe } from '../../stripe-ingest';
import { eventStats, nonce, rejectedSince, stripeHeader, webhookTarget } from '../helpers';
import { fail, pass, pending, type JudgeScenario } from '../types';

export const stripeForged: JudgeScenario = {
  id: 'stripe-forged',
  criterion: 6,
  reqs: ['I2.3'],
  expected: 'Wrong signature: 400, the event is rejected and never stored as received/processed',
  async run({ actor, step }) {
    const t = await webhookTarget(actor.workspaceId, 'stripe');
    if (!t.ok) return pending(t.why);
    const evtId = `evt_judge_forged_${nonce()}`;
    const rawBody = JSON.stringify({
      id: evtId,
      object: 'event',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    const started = new Date();
    const req = (sig: string) => ({
      method: 'POST',
      url: new URL(`https://relay.invalid/api/webhooks/stripe/${t.connectionKey}`),
      headers: new Headers({ 'stripe-signature': sig, 'content-type': 'application/json' }),
      rawBody,
    });
    const wrong = await ingestStripe({
      connectionKey: t.connectionKey,
      req: req(stripeHeader('whsec_forged_by_judge', rawBody)),
      ip: 'judge-console',
    });
    step('Signed with the wrong secret', wrong.status === 400, `HTTP ${wrong.status}`);
    const tampered = await ingestStripe({
      connectionKey: t.connectionKey,
      req: { ...req(stripeHeader(t.secret, rawBody)), rawBody: rawBody.replace('checkout', 'chekout') },
      ip: 'judge-console',
    });
    step('Valid signature, body altered after signing', tampered.status === 400, `HTTP ${tampered.status}`);
    const missing = await ingestStripe({ connectionKey: t.connectionKey, req: req(''), ip: 'judge-console' });
    step('No signature header value', missing.status === 400, `HTTP ${missing.status}`);

    const stored = await eventStats(actor.workspaceId, 'stripe', evtId);
    step('Event stored as received', stored.rows === 0, `${stored.rows} rows for ${evtId}`);
    const rejected = await rejectedSince(actor.workspaceId, 'stripe', started);
    step('Rejections recorded in sync history', rejected >= 1, `${rejected} rejected row(s)`);

    const ok =
      wrong.status === 400 &&
      tampered.status === 400 &&
      missing.status === 400 &&
      stored.rows === 0 &&
      rejected >= 1;
    return (ok ? pass : fail)(
      `wrong secret ${wrong.status}, altered body ${tampered.status}, no signature ${missing.status}; stored events: ${stored.rows}; rejected rows logged: ${rejected}`,
      [{ key: 'syncHistory', href: '/settings/integrations' }],
    );
  },
};
