// I2.4 / rubric 6: the same signed Stripe event delivered twice is counted once.
import { ingestStripe } from '../../stripe-ingest';
import { eventStats, neutralizeProbe, nonce, stripeHeader, webhookTarget } from '../helpers';
import { fail, pass, pending, type JudgeScenario } from '../types';

export const stripeDuplicate: JudgeScenario = {
  id: 'stripe-duplicate',
  criterion: 6,
  reqs: ['I2.4'],
  expected: 'Same event id twice: 200 both times, exactly 1 stored event, duplicate_count = 1',
  async run({ actor, step }) {
    const t = await webhookTarget(actor.workspaceId, 'stripe');
    if (!t.ok) return pending(t.why);
    const evtId = `evt_judge_dup_${nonce()}`;
    // An event type we do not act on: the idempotency layer is what is under test, no money moves.
    const rawBody = JSON.stringify({
      id: evtId,
      object: 'event',
      type: 'judge.ping',
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
    });
    const send = () =>
      ingestStripe({
        connectionKey: t.connectionKey,
        req: {
          method: 'POST',
          url: new URL(`https://relay.invalid/api/webhooks/stripe/${t.connectionKey}`),
          headers: new Headers({
            'stripe-signature': stripeHeader(t.secret, rawBody),
            'content-type': 'application/json',
          }),
          rawBody,
        },
        ip: 'judge-console',
      });
    const a = await send();
    step('Delivery 1 (signed with the real webhook secret)', a.status === 200, `HTTP ${a.status}`);
    const b = await send();
    step('Delivery 2 (identical event id)', b.status === 200, `HTTP ${b.status}`);
    await neutralizeProbe(actor.workspaceId, 'stripe', evtId);
    const s = await eventStats(actor.workspaceId, 'stripe', evtId);
    step('Stored events for this id', s.rows === 1, `${s.rows} row, duplicate_count=${s.duplicates}`);
    const ok = a.status === 200 && b.status === 200 && s.rows === 1 && s.duplicates === 1;
    return (ok ? pass : fail)(
      `HTTP ${a.status} then ${b.status}; stored ${s.rows} event(s); duplicate_count=${s.duplicates}`,
      [{ key: 'syncHistory', href: '/settings/integrations' }],
    );
  },
};
