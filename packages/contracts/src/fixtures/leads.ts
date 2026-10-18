// Fixture builders for leads contracts (13 §4). Owner: Lane A. Pattern: ./users.ts.
import type { LeadDetail, LeadSummary, TickNudgeResponse } from '../api/leads';
import { FIXTURE_OWNER_ID, FIXTURE_USER_ID } from './users';

export const FIXTURE_LEAD_ID = '0192f3a0-0000-7000-8000-00000000c001';

export function buildTickNudge(): TickNudgeResponse {
  return { accepted: true };
}

export function buildLeadSummary(overrides: Partial<LeadSummary> = {}): LeadSummary {
  return {
    id: FIXTURE_LEAD_ID,
    contactName: 'Kamran Butt',
    contactPhone: '+923001234567',
    contactEmail: null,
    sourceKind: 'web_form',
    sourceLabel: 'Sunrise Solar',
    status: 'open',
    state: 'assignedPending',
    owner: { id: FIXTURE_USER_ID, name: 'Bilal Ahmed' },
    custody: 'handler',
    awaitingHandler: false,
    awaitingReason: null,
    ackStatus: 'pending',
    isUrgent: false,
    isCritical: false,
    escalationLevel: 1,
    escalationCount: 0,
    overdueAttemptCount: 0,
    idleRetriggerCount: 0,
    ackWindowEndsAt: '2026-10-18T09:02:00.000Z',
    firstAssignedAt: '2026-10-18T09:00:00.000Z',
    assignedAt: '2026-10-18T09:00:00.000Z',
    acknowledgedAt: null,
    createdAt: '2026-10-18T09:00:00.000Z',
    version: 0,
    canAcknowledge: true,
    ...overrides,
  };
}

export function buildLeadDetail(overrides: Partial<LeadDetail> = {}): LeadDetail {
  return {
    ...buildLeadSummary(),
    message: 'Need a 5 kW solar quote for my house in DHA.',
    baseWindowEndsAt: '2026-10-18T09:02:00.000Z',
    events: [
      {
        id: '0192f3a0-0000-7000-8000-00000000e001',
        type: 'intake_assigned',
        from: null,
        to: { id: FIXTURE_USER_ID, name: 'Bilal Ahmed' },
        custody: 'handler',
        escalationLevel: 1,
        trace: [
          { outcome: 'skipped', userId: FIXTURE_OWNER_ID, name: 'Hina Raza', reason: 'on_leave' },
          { outcome: 'chosen', userId: FIXTURE_USER_ID, name: 'Bilal Ahmed', reason: 'round_robin_next' },
        ],
        meta: null,
        actorType: 'system',
        occurredAt: '2026-10-18T09:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** One entry per endpoint in leadsEndpoints, used by the api-client in fixture mode. */
export const leadsFixtures = {
  tickNudge: () => buildTickNudge(),
  list: () => ({
    items: [
      buildLeadSummary(),
      buildLeadSummary({
        id: '0192f3a0-0000-7000-8000-00000000c002',
        contactName: 'Nadia Hussain',
        state: 'awaitingHandler',
        custody: 'fallback',
        awaitingHandler: true,
        awaitingReason: 'no_available',
        owner: { id: FIXTURE_OWNER_ID, name: 'Sana Malik' },
        canAcknowledge: false,
      }),
    ],
    nextCursor: null,
  }),
  get: () => buildLeadDetail(),
  create: () => buildLeadDetail(),
  acknowledge: () =>
    buildLeadDetail({
      ackStatus: 'acknowledged',
      state: 'acknowledged',
      ackWindowEndsAt: null,
      canAcknowledge: false,
    }),
  sources: () => ({
    items: [
      { key: 'walk_in', label: 'Walk-in', kind: 'manual' as const },
      { key: 'phone_call', label: 'Phone call', kind: 'manual' as const },
      { key: 'referral', label: 'Referral', kind: 'manual' as const },
    ],
  }),
} as const;
