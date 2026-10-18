// Fixture builders for dashboard contracts (13 section 4). Owner: Lane D. Pattern: ./users.ts.
// Realistic Sunrise Solar data: figures agree with each other (stage counts, queue, chips).
import type { OverviewResponse, RadarResponse } from '../api/dashboard';

const U = {
  ayesha: '0192f3a0-0000-7000-8000-000000000101',
  hamza: '0192f3a0-0000-7000-8000-000000000102',
  sana: '0192f3a0-0000-7000-8000-000000000103',
  bilal: '0192f3a0-0000-7000-8000-000000000104',
  zara: '0192f3a0-0000-7000-8000-000000000105',
  imran: '0192f3a0-0000-7000-8000-000000000106',
} as const;

const dayKey = (base: Date, offset: number): string =>
  new Date(base.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

const WAVE = [
  18, 24, 31, 22, 40, 52, 14, 27, 35, 44, 29, 61, 48, 12, 30, 38, 46, 33, 57, 64, 21, 36, 43, 51, 39, 70, 66,
  25, 49, 58,
];

export function buildOverview(overrides: Partial<OverviewResponse> = {}): OverviewResponse {
  const now = new Date();
  const days = WAVE.length;
  const series = WAVE.map((k, i) => ({
    date: dayKey(now, i - (days - 1)),
    collectedMinor: k * 1_000_000,
    payments: Math.max(1, Math.round(k / 12)),
  }));
  const total = series.reduce((s, d) => s + (d.collectedMinor ?? 0), 0);
  return {
    generatedAt: now.toISOString(),
    scope: 'company',
    currency: 'PKR',
    timezone: 'Asia/Karachi',
    newLeadsToday: { value: 12, previous: 9, spark: [6, 9, 7, 11, 8, 9, 12] },
    avgFirstResponse: {
      seconds: 252,
      previousSeconds: 318,
      samples: 8,
      spark: [380, 330, 340, 300, 318, 280, 252],
    },
    recoveryQueue: { count: 5, critical: 1 },
    attention: { waitingAck: 3, escalatedToday: 2, needAttention: 2 },
    payments: { days, total: { value: total, masked: false }, series },
    leadsPerDay: WAVE.map((k, i) => ({
      date: dayKey(now, i - (days - 1)),
      leads: Math.round(k / 5) + 2,
      escalations: k % 7 === 0 ? 2 : k % 3 === 0 ? 1 : 0,
    })),
    team: {
      members: [
        { userId: U.ayesha, name: 'Ayesha Khan', availability: 'available', openLeads: 2 },
        { userId: U.hamza, name: 'Usman Tariq', availability: 'available', openLeads: 4 },
        { userId: U.sana, name: 'Sana Malik', availability: 'busy', openLeads: 5 },
        { userId: U.bilal, name: 'Bilal Ahmed', availability: 'available', openLeads: 3 },
        { userId: U.zara, name: 'Hina Raza', availability: 'on_leave', openLeads: 0 },
        { userId: U.imran, name: 'Imran Qureshi', availability: 'offline', openLeads: 1 },
      ],
    },
    pipeline: {
      stages: [
        { stageId: 's1', name: 'New', count: 14, value: { value: 42_000_000, masked: false } },
        { stageId: 's2', name: 'Site survey', count: 9, value: { value: 81_000_000, masked: false } },
        { stageId: 's3', name: 'Proposal sent', count: 6, value: { value: 126_000_000, masked: false } },
        { stageId: 's4', name: 'Negotiation', count: 3, value: { value: 94_000_000, masked: false } },
      ],
      total: { value: 343_000_000, masked: false },
    },
    appointments: {
      total: 7,
      items: [
        {
          id: '0192f3a0-0000-7000-8000-000000000601',
          startsAt: new Date(now.getTime() + 2 * 3_600_000).toISOString(),
          title: 'Site survey',
          contactName: 'Tariq Mehmood',
          ownerName: 'Usman Tariq',
        },
        {
          id: '0192f3a0-0000-7000-8000-000000000602',
          startsAt: new Date(now.getTime() + 5 * 3_600_000).toISOString(),
          title: 'Proposal call',
          contactName: 'Nadia Hussain',
          ownerName: 'Sana Malik',
        },
        {
          id: '0192f3a0-0000-7000-8000-000000000603',
          startsAt: new Date(now.getTime() + 26 * 3_600_000).toISOString(),
          title: 'Site survey',
          contactName: 'Faisal Raza',
          ownerName: 'Bilal Ahmed',
        },
      ],
    },
    escalations24h: { count: 4, idleRetriggers: 1 },
    revenueAtRisk: { value: 145_000_000, masked: false },
    revenueRescued: { value: 62_000_000, masked: false },
    ...overrides,
  };
}

/** Radar with deadlines relative to `now` so rings tick in fixture mode. */
export function buildRadar(now = new Date()): RadarResponse {
  const at = (sec: number) => new Date(now.getTime() + sec * 1000).toISOString();
  const lead = (
    n: number,
    contactName: string,
    sourceLabel: string,
    owner: keyof typeof U,
    ownerName: string,
    remainingSec: number | null,
    extra: Partial<RadarResponse['leads'][number]> = {},
  ): RadarResponse['leads'][number] => ({
    id: `0192f3a0-0000-7000-8000-000000000${500 + n}`,
    contactName,
    sourceLabel,
    ownerUserId: U[owner],
    ownerName,
    custody: 'handler',
    awaitingHandler: false,
    awaitingReason: null,
    ackWindowEndsAt: remainingSec === null ? null : at(remainingSec),
    windowMs: 300_000,
    escalationLevel: 0,
    isUrgent: false,
    isCritical: false,
    ...extra,
  });
  return {
    now: now.toISOString(),
    members: [
      { userId: U.ayesha, name: 'Ayesha Khan', availability: 'available', isCustodian: true },
      { userId: U.hamza, name: 'Usman Tariq', availability: 'available', isCustodian: false },
      { userId: U.sana, name: 'Sana Malik', availability: 'busy', isCustodian: false },
      { userId: U.bilal, name: 'Bilal Ahmed', availability: 'available', isCustodian: false },
      { userId: U.zara, name: 'Hina Raza', availability: 'on_leave', isCustodian: false },
    ],
    leads: [
      lead(1, 'Tariq Mehmood', 'WhatsApp', 'hamza', 'Usman Tariq', 240),
      lead(2, 'Nadia Hussain', 'Web form', 'hamza', 'Usman Tariq', 95, { isUrgent: true }),
      lead(3, 'Faisal Raza', 'WhatsApp', 'sana', 'Sana Malik', 38, { escalationLevel: 1 }),
      lead(4, 'Rabia Anwar', 'WhatsApp', 'bilal', 'Bilal Ahmed', 270),
      lead(5, 'Usman Gondal', 'Manual', 'sana', 'Sana Malik', -42, { escalationLevel: 1 }),
      lead(6, 'Mariam Baig', 'Web form', 'ayesha', 'Ayesha Khan', 120, {
        custody: 'fallback',
        awaitingHandler: true,
        awaitingReason: 'no_available',
        isCritical: true,
      }),
    ],
  };
}

const T0 = Date.now();
const CHAIN = [U.hamza, U.sana, U.bilal] as const;
const NAMES: Record<string, string> = {
  [U.hamza]: 'Usman Tariq',
  [U.sana]: 'Sana Malik',
  [U.bilal]: 'Bilal Ahmed',
};

/**
 * A radar that PLAYS in fixture mode: deadlines are fixed at module load and, whenever a window runs out, the
 * lead escalates to the next owner in the chain with a fresh window (what the server does for real).
 */
export function buildLiveRadar(now = new Date()): RadarResponse {
  const base = buildRadar(new Date(T0));
  const elapsed = (now.getTime() - T0) / 1000;
  return {
    ...base,
    now: now.toISOString(),
    leads: base.leads.map((l) => {
      if (l.awaitingHandler || !l.ackWindowEndsAt) return l;
      const remaining = (Date.parse(l.ackWindowEndsAt) - T0) / 1000;
      if (elapsed <= remaining) return l;
      const win = l.windowMs / 1000;
      const k = Math.floor((elapsed - remaining) / win) + 1;
      const idx = CHAIN.indexOf(l.ownerUserId as (typeof CHAIN)[number]);
      const owner = CHAIN[(Math.max(idx, 0) + k) % CHAIN.length]!;
      return {
        ...l,
        ownerUserId: owner,
        ownerName: NAMES[owner]!,
        escalationLevel: l.escalationLevel + k,
        ackWindowEndsAt: new Date(T0 + (remaining + k * win) * 1000).toISOString(),
      };
    }),
  };
}

/** One entry per endpoint in dashboardEndpoints, used by the api-client in fixture mode. */
export const dashboardFixtures = {
  overview: () => buildOverview(),
  radar: () => buildLiveRadar(),
} as const;
