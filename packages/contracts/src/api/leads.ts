// leads API contracts: Zod request/response schemas + endpoint descriptors (docs/11-api.md). Owner: Lane A.
// Engine spec: docs/03-lead-engine.md. Vocabulary from 03 §1 (custody, awaiting reason, …).
import { z } from 'zod';
import { endpoint } from './endpoint';

const isoDate = z.iso.datetime({ offset: true });

/** POST /api/v1/tick-nudge → 202. The server runs due work after responding; it changes nothing itself. */
export const tickNudgeResponse = z.object({ accepted: z.literal(true) });
export type TickNudgeResponse = z.infer<typeof tickNudgeResponse>;

export const custodySchema = z.enum(['handler', 'fallback']);
export const awaitingReasonSchema = z.enum([
  'no_available',
  'all_at_capacity',
  'no_skill_match',
  'first_to_claim_pending',
  'chain_exhausted',
  'owner_absent',
  'owner_deactivated',
]);
/** UI label (03 §2, i18n `lead.state.*`). */
export const leadStateSchema = z.enum([
  'awaitingHandler',
  'assignedPending',
  'overdue',
  'critical',
  'acknowledged',
  'idle',
  'closed',
]);
export type LeadState = z.infer<typeof leadStateSchema>;
export const leadSourceKindSchema = z.enum(['web_form', 'whatsapp', 'manual']);

export const userRef = z.object({ id: z.uuid(), name: z.string() });

export const leadSummary = z.object({
  id: z.uuid(),
  contactName: z.string(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  sourceKind: leadSourceKindSchema,
  sourceLabel: z.string(),
  status: z.enum(['open', 'closed']),
  state: leadStateSchema,
  owner: userRef,
  custody: custodySchema,
  awaitingHandler: z.boolean(),
  awaitingReason: awaitingReasonSchema.nullable(),
  ackStatus: z.enum(['pending', 'acknowledged']),
  isUrgent: z.boolean(),
  isCritical: z.boolean(),
  escalationLevel: z.number().int(),
  escalationCount: z.number().int(),
  overdueAttemptCount: z.number().int(),
  idleRetriggerCount: z.number().int(),
  /** Countdown target while pending (null once acknowledged). */
  ackWindowEndsAt: isoDate.nullable(),
  firstAssignedAt: isoDate,
  assignedAt: isoDate,
  acknowledgedAt: isoDate.nullable(),
  createdAt: isoDate,
  version: z.number().int(),
  /** The actor is the owner in handler custody and the lead is pending (03 T2). */
  canAcknowledge: z.boolean(),
});
export type LeadSummary = z.infer<typeof leadSummary>;

export const traceEntrySchema = z.object({
  outcome: z.enum(['skipped', 'chosen', 'broadcast', 'fallback']),
  userId: z.string().nullable(),
  name: z.string().nullable(),
  reason: z.string(),
  level: z.number().int().optional(),
  openCount: z.number().int().optional(),
  capacity: z.number().int().optional(),
  awaitingReason: z.string().optional(),
});

export const leadEventDto = z.object({
  id: z.uuid(),
  type: z.string(),
  from: userRef.nullable(),
  to: userRef.nullable(),
  custody: custodySchema.nullable(),
  escalationLevel: z.number().int().nullable(),
  trace: z.array(traceEntrySchema).nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  actorType: z.enum(['user', 'system', 'ai']),
  occurredAt: isoDate,
});
export type LeadEventDto = z.infer<typeof leadEventDto>;

export const leadDetail = leadSummary.extend({
  message: z.string().nullable(),
  baseWindowEndsAt: isoDate,
  events: z.array(leadEventDto),
});
export type LeadDetail = z.infer<typeof leadDetail>;

export const leadsListQuery = z
  .object({
    view: z.enum(['mine', 'all']).optional(),
    status: z.enum(['open', 'closed', 'all']).optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export const leadsListResponse = z.object({ items: z.array(leadSummary), nextCursor: z.uuid().nullable() });

export const createLeadInput = z
  .object({
    contactName: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(32).optional(),
    email: z.email().max(254).optional(),
    message: z.string().trim().max(4000).optional(),
    /** lead_sources.key of a manual source (walk-in, phone call, referral, …). */
    sourceKey: z.string().min(1).max(64),
    teamId: z.uuid().optional(),
    isUrgent: z.boolean().optional(),
  })
  .strict();
export type CreateLeadInput = z.infer<typeof createLeadInput>;

export const acknowledgeInput = z.object({ version: z.number().int().optional() }).strict();
export const leadIdParams = z.object({ id: z.uuid() });

export const leadSourceDto = z.object({ key: z.string(), label: z.string(), kind: leadSourceKindSchema });
export const leadSourcesResponse = z.object({ items: z.array(leadSourceDto) });

// ── public web form (F3.1) ──────────────────────────────────────────────
export const publicFormParams = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/) });
export const publicFormSubmit = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(32).optional(),
    email: z.email().max(254).optional().or(z.literal('')),
    message: z.string().trim().max(4000).optional(),
    /** Honeypot: humans leave it empty (06 §7). */
    website: z.string().max(200).optional(),
  })
  .refine((v) => !!v.phone || !!v.email, { path: ['phone'], message: 'phone_or_email_required' });
export type PublicFormSubmit = z.infer<typeof publicFormSubmit>;
/** Always the same answer whatever the routing outcome (03 T1 step 6). */
export const publicFormResponse = z.object({ ok: z.literal(true), bookingAvailable: z.boolean() });

export const leadsEndpoints = {
  /**
   * Countdown hit 0 / Lead Radar overdue (07 §3): ask the server to run due work now, so an
   * escalation lands promptly even if the QStash wake is late. Session + CSRF, 6/min per user.
   */
  tickNudge: endpoint({ method: 'POST', path: '/api/v1/tick-nudge', response: tickNudgeResponse }),
  /** GET /api/v1/leads: own leads, or all with `leads.view_all` (06 §2). */
  list: endpoint({
    method: 'GET',
    path: '/api/v1/leads',
    query: leadsListQuery,
    response: leadsListResponse,
  }),
  /** GET /api/v1/leads/:id: detail incl. events + routing trace. Out of scope → 404. */
  get: endpoint({ method: 'GET', path: '/api/v1/leads/:id', params: leadIdParams, response: leadDetail }),
  /** POST /api/v1/leads (leads.create): T1 manual intake. 201. */
  create: endpoint({ method: 'POST', path: '/api/v1/leads', body: createLeadInput, response: leadDetail }),
  /** POST /api/v1/leads/:id/acknowledge: owner only (T2). Stale/not owner → 409 LEAD_STATE_CHANGED. */
  acknowledge: endpoint({
    method: 'POST',
    path: '/api/v1/leads/:id/acknowledge',
    params: leadIdParams,
    body: acknowledgeInput,
    response: leadDetail,
  }),
  /** GET /api/v1/lead-sources: manual-entry source list (F3.1). */
  sources: endpoint({ method: 'GET', path: '/api/v1/lead-sources', response: leadSourcesResponse }),
} as const;
