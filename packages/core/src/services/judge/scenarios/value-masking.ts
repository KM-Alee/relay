// F1.4 / rubric 1: a plain User never receives an opportunity value, through the service that backs the API.
import { contactsService, opportunitiesService } from '../../crm-records';
import { nonce, plainUser } from '../helpers';
import { fail, pass, type JudgeScenario } from '../types';

export const valueMasking: JudgeScenario = {
  id: 'value-masking',
  criterion: 1,
  reqs: ['F1.4', 'Q3'],
  expected: 'Owner sees the value; the same opportunity read as a plain User is {masked:true}',
  async run({ actor, step }) {
    const user = plainUser(actor);
    const tag = nonce();
    const contact = await contactsService.create(actor, {
      name: `[judge] masking ${tag}`,
      ownerUserId: actor.userId,
    });
    let oppId: string | null = null;
    try {
      const opp = await opportunitiesService.create(actor, {
        title: `[judge] value ${tag}`,
        contactId: contact.id,
        valueMinor: 1_234_500,
      });
      oppId = opp.id;
      const asOwner = await opportunitiesService.get(actor, opp.id);
      const ownerSees = asOwner.value?.masked === false && asOwner.value.amountMinor === 1_234_500;
      step('Read as Owner', ownerSees, `value=${JSON.stringify(asOwner.value)}`);

      const asUser = await opportunitiesService.get(user, opp.id);
      const hidden = asUser.value?.masked === true;
      step('Read as plain User (same record, same service)', hidden, `value=${JSON.stringify(asUser.value)}`);

      const list = await opportunitiesService.list(user, { contactId: contact.id });
      const listHidden = list.items.length > 0 && list.items.every((o) => o.value?.masked === true);
      step('List as plain User', listHidden, `${list.items.length} item(s), all masked`);

      const raw = JSON.stringify([asUser, list]);
      const leaked = raw.includes('1234500');
      step('Serialized response contains no trace of the number', !leaked);

      const ok = ownerSees && hidden && listHidden && !leaked;
      const evidence = [{ key: 'opportunity' as const, href: `/pipeline` }];
      return ok
        ? pass(`owner: amountMinor=1234500; user: value={masked:true}; list masked; payload clean`, evidence)
        : fail(
            `owner=${JSON.stringify(asOwner.value)}; user=${JSON.stringify(asUser.value)}; list masked=${listHidden}; leaked=${leaked}`,
            evidence,
          );
    } finally {
      if (oppId) await opportunitiesService.remove(actor, oppId).catch(() => undefined);
      await contactsService.remove(actor, contact.id).catch(() => undefined);
    }
  },
};
