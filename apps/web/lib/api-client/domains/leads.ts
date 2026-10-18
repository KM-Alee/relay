// api.leads.*: owner Lane A. One method per endpoint in contracts/api/leads.ts; pattern: ./users.ts.
import {
  leadsEndpoints,
  type CreateLeadInput,
  type RecoveryReason,
  type ReassignInput,
} from '@relay/contracts/api/leads';
import { leadsFixtures } from '@relay/contracts/fixtures/leads';
import { call, type CallOptions } from '../http';

export const leads = {
  /** Countdown reached 0: run due work now (the caller debounces once per lead). */
  tickNudge: (opts?: CallOptions) =>
    call('leads', leadsEndpoints.tickNudge, {}, () => leadsFixtures.tickNudge(), opts),
  list: (
    query: {
      view?: 'mine' | 'all';
      status?: 'open' | 'closed' | 'all';
      cursor?: string;
      limit?: number;
      state?: 'pending';
      created?: 'today';
      escalated?: 'today' | '24h';
    } = {},
    opts?: CallOptions,
  ) => call('leads', leadsEndpoints.list, { query }, () => leadsFixtures.list(), opts),
  get: (id: string, opts?: CallOptions) =>
    call('leads', leadsEndpoints.get, { params: { id } }, () => leadsFixtures.get(), opts),
  create: (body: CreateLeadInput, opts?: CallOptions) =>
    call('leads', leadsEndpoints.create, { body }, () => leadsFixtures.create(), opts),
  acknowledge: (id: string, version?: number, opts?: CallOptions) =>
    call(
      'leads',
      leadsEndpoints.acknowledge,
      { params: { id }, body: { version } },
      () => leadsFixtures.acknowledge(),
      opts,
    ),
  reassignTargets: (id: string, opts?: CallOptions) =>
    call(
      'leads',
      leadsEndpoints.reassignTargets,
      { params: { id } },
      () => leadsFixtures.reassignTargets(),
      opts,
    ),
  reassign: (id: string, body: ReassignInput, opts?: CallOptions) =>
    call('leads', leadsEndpoints.reassign, { params: { id }, body }, () => leadsFixtures.reassign(), opts),
  takeOver: (id: string, opts?: CallOptions) =>
    call(
      'leads',
      leadsEndpoints.takeOver,
      { params: { id }, body: {} },
      () => leadsFixtures.takeOver(),
      opts,
    ),
  recovery: (query: { reason?: RecoveryReason; mine?: '1' | '0' } = {}, opts?: CallOptions) =>
    call('leads', leadsEndpoints.recovery, { query }, () => leadsFixtures.recovery(), opts),
  sources: (opts?: CallOptions) =>
    call('leads', leadsEndpoints.sources, {}, () => leadsFixtures.sources(), opts),
};
