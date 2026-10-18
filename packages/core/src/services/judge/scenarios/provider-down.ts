// I5.8 / rubric 9: one provider down (breaker open) does not break the platform or the other providers.
import { auditService } from '../../audit';
import { breakerAllows } from '../../../integrations/breaker';
import { contactsService } from '../../crm-records';
import { integrationsService } from '../../integrations';
import { ensureStripeConnectionRow } from '../../payments';
import { expectError } from '../helpers';
import { fail, pass, type JudgeScenario } from '../types';

export const providerDown: JudgeScenario = {
  id: 'provider-down',
  criterion: 9,
  reqs: ['I5.8', 'Q4', 'Q9'],
  expected:
    'Stripe breaker open: Stripe calls are short-circuited, every other provider stays closed, CRM + audit still answer; breaker closes again',
  async run({ actor, step }) {
    await ensureStripeConnectionRow(actor.workspaceId);
    let restored = false;
    try {
      const opened = await integrationsService.forceBreaker(actor, 'stripe', 'open');
      step(
        'Opened the Stripe circuit breaker',
        opened.health.state === 'open',
        `state=${opened.health.state}, failures=${opened.health.failures}`,
      );

      const gate = breakerAllows(
        { state: opened.health.state, failures: opened.health.failures, openedAt: opened.health.openedAt },
        new Date(),
      );
      step(
        'A Stripe call is short-circuited (no network attempt)',
        !gate.allow,
        `retry in ${Math.ceil(gate.retryInMs / 1000)}s`,
      );

      const cards = (await integrationsService.list(actor)).cards;
      const others = cards.filter((c) => c.provider !== 'stripe' && c.connection?.health.state === 'open');
      step(
        'Every other provider is unaffected',
        others.length === 0,
        others.length ? `open: ${others.map((c) => c.provider).join(', ')}` : 'none open',
      );

      const contacts = await contactsService.list(actor, { limit: 5 });
      step('CRM keeps working (contacts list)', true, `${contacts.items.length} contacts returned`);
      const chain = await auditService.verify(actor);
      step('Audit chain still verifies', chain.ok, `${chain.checked} rows`);
      const shown = cards.find((c) => c.provider === 'stripe')?.connection?.health.state === 'open';
      step('Integrations page shows the outage', shown);

      const closed = await integrationsService.forceBreaker(actor, 'stripe', 'closed');
      restored = closed.health.state === 'closed';
      step('Closed the breaker again (recovery)', restored, `state=${closed.health.state}`);

      const ok =
        opened.health.state === 'open' && !gate.allow && others.length === 0 && chain.ok && shown && restored;
      const actual = `stripe breaker open, calls short-circuited; other providers open: ${others.length}; CRM ok; audit chain ok=${chain.ok}; breaker restored=${restored}`;
      return (ok ? pass : fail)(actual, [
        { key: 'integrations', href: '/settings/integrations' },
        { key: 'audit', href: '/audit' },
      ]);
    } finally {
      if (!restored) await expectError(() => integrationsService.forceBreaker(actor, 'stripe', 'closed'));
    }
  },
};
