// I1.2 / rubric 5: a forged Meta (WhatsApp) webhook is rejected (401) and creates nothing.
import { ingestWhatsApp } from '../../messaging-ingest';
import { eventStats, metaHeader, nonce, rejectedSince, webhookTarget } from '../helpers';
import { fail, pass, pending, type JudgeScenario } from '../types';

export const metaForged: JudgeScenario = {
  id: 'meta-forged',
  criterion: 5,
  reqs: ['I1.2'],
  expected: 'Wrong X-Hub-Signature-256: 401, no message event stored',
  async run({ actor, step }) {
    const t = await webhookTarget(actor.workspaceId, 'meta_whatsapp');
    if (!t.ok) return pending(t.why);
    const wamid = `wamid.JUDGEFORGED${nonce()}`;
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
                contacts: [{ profile: { name: 'Judge' }, wa_id: '920000000002' }],
                messages: [
                  {
                    from: '920000000002',
                    id: wamid,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'forged' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const started = new Date();
    const send = (sig: string | null, body = rawBody) =>
      ingestWhatsApp({
        connectionKey: t.connectionKey,
        req: {
          method: 'POST',
          url: new URL(`https://relay.invalid/api/webhooks/meta/${t.connectionKey}`),
          headers: new Headers({
            ...(sig ? { 'x-hub-signature-256': sig } : {}),
            'content-type': 'application/json',
          }),
          rawBody: body,
        },
        ip: 'judge-console',
      });
    const wrong = await send(metaHeader('forged_by_judge', rawBody));
    step('Signed with the wrong app secret', wrong.status === 401, `HTTP ${wrong.status}`);
    const altered = await send(metaHeader(t.secret, rawBody), rawBody.replace('forged', 'FORGED'));
    step('Valid signature, body altered after signing', altered.status === 401, `HTTP ${altered.status}`);
    const none = await send(null);
    step('No signature header', none.status === 401, `HTTP ${none.status}`);
    const stored = await eventStats(actor.workspaceId, 'meta_whatsapp', wamid);
    step('Message event stored', stored.rows === 0, `${stored.rows} rows`);
    const rejected = await rejectedSince(actor.workspaceId, 'meta_whatsapp', started);
    step('Rejections recorded in sync history', rejected >= 1, `${rejected} rejected row(s)`);
    const ok =
      wrong.status === 401 &&
      altered.status === 401 &&
      none.status === 401 &&
      stored.rows === 0 &&
      rejected >= 1;
    return (ok ? pass : fail)(
      `wrong secret ${wrong.status}, altered body ${altered.status}, no header ${none.status}; stored: ${stored.rows}; rejected rows logged: ${rejected}`,
      [{ key: 'syncHistory', href: '/settings/integrations' }],
    );
  },
};
