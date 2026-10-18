// I1.8 / rubric 5: the same inbound wamid delivered twice yields one message event.
import { ingestWhatsApp } from '../../messaging-ingest';
import { eventStats, metaHeader, neutralizeProbe, nonce, webhookTarget } from '../helpers';
import { fail, pass, pending, type JudgeScenario } from '../types';

export const metaDuplicate: JudgeScenario = {
  id: 'meta-duplicate',
  criterion: 5,
  reqs: ['I1.8'],
  expected: 'Same wamid twice: 200 both times, exactly 1 stored message event, duplicate_count = 1',
  async run({ actor, step }) {
    const t = await webhookTarget(actor.workspaceId, 'meta_whatsapp');
    if (!t.ok) return pending(t.why);
    const wamid = `wamid.JUDGEDUP${nonce()}`;
    const rawBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '0',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: t.phoneNumberId ?? '0' },
                contacts: [{ profile: { name: 'Judge probe' }, wa_id: '920000000001' }],
                messages: [
                  {
                    from: '920000000001',
                    id: wamid,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'judge duplicate probe' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const send = () =>
      ingestWhatsApp({
        connectionKey: t.connectionKey,
        req: {
          method: 'POST',
          url: new URL(`https://relay.invalid/api/webhooks/meta/${t.connectionKey}`),
          headers: new Headers({
            'x-hub-signature-256': metaHeader(t.secret, rawBody),
            'content-type': 'application/json',
          }),
          rawBody,
        },
        ip: 'judge-console',
      });
    const a = await send();
    step(
      'Delivery 1 (signed with the real app secret)',
      a.status === 200,
      `HTTP ${a.status}, ${a.newEvents.length} new event`,
    );
    const b = await send();
    step(
      'Delivery 2 (identical wamid)',
      b.status === 200,
      `HTTP ${b.status}, ${b.newEvents.length} new events`,
    );
    // The probe must not create a real contact/lead for a fake number: mark it handled before any worker sees it.
    await neutralizeProbe(actor.workspaceId, 'meta_whatsapp', wamid);
    const s = await eventStats(actor.workspaceId, 'meta_whatsapp', wamid);
    step(
      'Stored message events for this wamid',
      s.rows === 1,
      `${s.rows} row, duplicate_count=${s.duplicates}`,
    );
    const ok =
      a.status === 200 &&
      b.status === 200 &&
      a.newEvents.length === 1 &&
      b.newEvents.length === 0 &&
      s.rows === 1 &&
      s.duplicates === 1;
    return (ok ? pass : fail)(
      `HTTP ${a.status} then ${b.status}; new events ${a.newEvents.length} then ${b.newEvents.length}; stored ${s.rows}; duplicate_count=${s.duplicates}`,
      [{ key: 'syncHistory', href: '/settings/integrations' }],
    );
  },
};
