// api.automations.*: owner Lane A. One method per endpoint in contracts/api/automations.ts (real routes only).
import { automationsEndpoints as e } from '@relay/contracts/api/automations';
import { call, type CallInput, type CallOptions } from '../http';

const noFixture = () => {
  throw new Error('automations has no fixtures');
};

export const automations = {
  listPolicies: (opts?: CallOptions) => call('automations', e.listPolicies, {}, noFixture, opts),
  createPolicy: (body: CallInput<typeof e.createPolicy>['body'], opts?: CallOptions) =>
    call('automations', e.createPolicy, { body }, noFixture, opts),
  publishPolicy: (id: string, body: CallInput<typeof e.updatePolicy>['body'], opts?: CallOptions) =>
    call('automations', e.updatePolicy, { params: { id }, body }, noFixture, opts),
  simulate: (body: CallInput<typeof e.simulate>['body'], opts?: CallOptions) =>
    call('automations', e.simulate, { body }, noFixture, opts),
  createTeam: (body: CallInput<typeof e.createTeam>['body'], opts?: CallOptions) =>
    call('automations', e.createTeam, { body }, noFixture, opts),
  updateTeam: (id: string, body: CallInput<typeof e.updateTeam>['body'], opts?: CallOptions) =>
    call('automations', e.updateTeam, { params: { id }, body }, noFixture, opts),
  intake: (opts?: CallOptions) => call('automations', e.intake, {}, noFixture, opts),
  updateWebForm: (id: string, body: CallInput<typeof e.updateWebForm>['body'], opts?: CallOptions) =>
    call('automations', e.updateWebForm, { params: { id }, body }, noFixture, opts),
  timeWarp: (opts?: CallOptions) => call('automations', e.timeWarp, {}, noFixture, opts),
  setTimeWarp: (multiplier: 1 | 10 | 60, opts?: CallOptions) =>
    call('automations', e.setTimeWarp, { body: { multiplier } }, noFixture, opts),
};
