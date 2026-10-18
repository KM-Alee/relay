// dashboard API contracts (docs/11-api.md, F5.*). Owner: Lane D.
// Money figures are produced by the server through core/auth/mask.ts (`MoneyFigureDto`); the client only
// renders the `masked` state. Definitions: docs/03-lead-engine.md section 8.
import { z } from 'zod';
import { moneyFigureSchema } from '../money';
import { endpoint } from './endpoint';
import { availabilitySchema } from './users';

const iso = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();

/** A count with its comparison value (yesterday / previous period) and a small trend series. */
export const trendFigure = z.object({
  value: count,
  previous: count.nullable(),
  spark: z.array(z.number()),
});

export const overviewQuery = z
  .object({
    /** Window of the payments chart (days). */
    days: z.coerce.number().int().min(7).max(90).optional(),
  })
  .strict();
export type OverviewQuery = z.infer<typeof overviewQuery>;

export const paymentsDay = z.object({
  /** Local calendar date `YYYY-MM-DD` in the workspace time zone. */
  date: z.string(),
  /** Collected (charges minus refunds) in minor units; null when masked. */
  collectedMinor: z.number().int().nullable(),
  payments: count,
});

export const leadsDay = z.object({ date: z.string(), leads: count, escalations: count });

export const teamMember = z.object({
  userId: z.uuid(),
  name: z.string(),
  availability: availabilitySchema,
  /** Open leads currently owned (waiting + acknowledged). */
  openLeads: count,
});

export const pipelineStage = z.object({
  stageId: z.string(),
  name: z.string(),
  count,
  /** Σ opportunity value; masked without crm.opportunity.value.view. */
  value: moneyFigureSchema,
});

export const upcomingAppointment = z.object({
  id: z.uuid(),
  startsAt: iso,
  title: z.string(),
  contactName: z.string(),
  ownerName: z.string(),
});

export const overviewResponse = z.object({
  generatedAt: iso,
  /** `company` = Owner/Admin (dashboard.company), `mine` = personal figures (F5.4). */
  scope: z.enum(['company', 'mine']),
  currency: z.string().length(3),
  timezone: z.string(),
  newLeadsToday: trendFigure,
  /** Average first_acknowledged_at - first_assigned_at over leads first acknowledged today (seconds). */
  avgFirstResponse: z.object({
    seconds: z.number().nonnegative().nullable(),
    previousSeconds: z.number().nonnegative().nullable(),
    samples: count,
    spark: z.array(z.number()),
  }),
  recoveryQueue: z.object({ count, critical: count }),
  /** Header chips. */
  attention: z.object({ waitingAck: count, escalatedToday: count, needAttention: count }),
  payments: z.object({
    days: z.number().int(),
    total: moneyFigureSchema,
    series: z.array(paymentsDay),
  }),
  /** Used instead of the payments chart when the viewer cannot see values. */
  leadsPerDay: z.array(leadsDay),
  team: z.object({ members: z.array(teamMember) }),
  pipeline: z.object({ stages: z.array(pipelineStage), total: moneyFigureSchema }),
  appointments: z.object({ total: count, items: z.array(upcomingAppointment) }),
  escalations24h: z.object({ count, idleRetriggers: count }),
  /** P1 (F5.7, F5.8): null when the viewer is not Owner/Admin (company scope). */
  revenueAtRisk: moneyFigureSchema.nullable(),
  revenueRescued: moneyFigureSchema.nullable(),
});
export type OverviewResponse = z.infer<typeof overviewResponse>;

// ── Lead Radar (F5.6) ───────────────────────────────────────────────────
export const radarMember = z.object({
  userId: z.uuid(),
  name: z.string(),
  availability: availabilitySchema,
  isCustodian: z.boolean(),
});

export const radarLead = z.object({
  id: z.uuid(),
  contactName: z.string(),
  sourceLabel: z.string(),
  ownerUserId: z.uuid(),
  ownerName: z.string(),
  /** `fallback` = manager/Owner custody, no handler accepted (F3 header). */
  custody: z.enum(['handler', 'fallback']),
  awaitingHandler: z.boolean(),
  awaitingReason: z.string().nullable(),
  /** Server deadline of the current ack window (null once acknowledged). */
  ackWindowEndsAt: iso.nullable(),
  windowMs: z.number().int().positive(),
  escalationLevel: z.number().int().nonnegative(),
  isUrgent: z.boolean(),
  isCritical: z.boolean(),
});
export type RadarLead = z.infer<typeof radarLead>;
export type RadarMember = z.infer<typeof radarMember>;

export const radarResponse = z.object({
  /** Server (DB) clock: the client derives its offset from it. */
  now: iso,
  members: z.array(radarMember),
  leads: z.array(radarLead),
});
export type RadarResponse = z.infer<typeof radarResponse>;

export const dashboardEndpoints = {
  /** GET /api/v1/dashboard/overview: every F5.1 figure for the actor's scope (F5.4). */
  overview: endpoint({
    method: 'GET',
    path: '/api/v1/dashboard/overview',
    query: overviewQuery,
    response: overviewResponse,
  }),
  /** GET /api/v1/dashboard/radar: waiting leads + team for Lead Radar (F5.6). */
  radar: endpoint({ method: 'GET', path: '/api/v1/dashboard/radar', response: radarResponse }),
} as const;
