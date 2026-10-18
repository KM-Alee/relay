// Automations contracts: escalation policies (F3.5), team admin, lead sources + web forms (F3.1),
// time-warp (F10.2). Owner: Lane A (T-124/T-202/T-210). Permission `routing.manage` unless noted.
import { z } from 'zod';
import { endpoint } from './endpoint';
import { teamDto } from './teams';

// ── Escalation policies ─────────────────────────────────────────────────
export const levelTargetSchema = z.enum(['next_eligible', 'team_backup', 'team_manager', 'user']);
export type LevelTarget = z.infer<typeof levelTargetSchema>;

export const policyLevelInput = z
  .object({
    targetType: levelTargetSchema,
    targetUserId: z.uuid().nullish(),
    /** Seconds (configured; time-warp scales the effective wait). */
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(7 * 24 * 3600),
  })
  .strict()
  .refine((l) => l.targetType !== 'user' || !!l.targetUserId, {
    path: ['targetUserId'],
    message: 'required',
  });
export type PolicyLevelInput = z.infer<typeof policyLevelInput>;

export const policyLevelDto = z.object({
  position: z.number().int(),
  targetType: levelTargetSchema,
  targetUserId: z.uuid().nullable(),
  timeoutSeconds: z.number().int(),
});

export const policyDto = z.object({
  id: z.uuid(),
  name: z.string(),
  repeatCount: z.number().int(),
  version: z.number().int(),
  updatedAt: z.iso.datetime({ offset: true }),
  levels: z.array(policyLevelDto),
  /** Teams that use this policy. */
  teamIds: z.array(z.uuid()),
});
export type PolicyDto = z.infer<typeof policyDto>;
export const policiesResponse = z.object({ items: z.array(policyDto) });

export const policyIdParams = z.object({ id: z.uuid() });
const levelsInput = z.array(policyLevelInput).min(1).max(8);
export const createPolicyInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    repeatCount: z.number().int().min(1).max(10).default(1),
    levels: levelsInput,
  })
  .strict();
/** Publish: replaces the levels, bumps `version` (409 STALE_VERSION on a lost race), audited. */
export const updatePolicyInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    repeatCount: z.number().int().min(1).max(10),
    levels: levelsInput,
    version: z.number().int(),
  })
  .strict();

export const simulateInput = z
  .object({
    teamId: z.uuid(),
    repeatCount: z.number().int().min(1).max(10),
    levels: levelsInput,
    urgent: z.boolean().optional(),
  })
  .strict();

export const simulateStep = z.object({
  /** Configured seconds since the lead arrived (what the policy says, before time-warp). */
  atSeconds: z.number().int(),
  kind: z.enum(['assigned', 'escalated', 'overdue', 'critical']),
  level: z.number().int(),
  toUserId: z.uuid().nullable(),
  toName: z.string().nullable(),
  fromName: z.string().nullable(),
  /** People skipped on the way (reason codes, localized by the UI). */
  skipped: z.array(z.object({ name: z.string().nullable(), reason: z.string() })),
  custody: z.enum(['handler', 'fallback']),
  /** How long this holder has before the next step (configured seconds). */
  waitSeconds: z.number().int().nullable(),
});
export type SimulateStep = z.infer<typeof simulateStep>;
export const simulateResponse = z.object({ steps: z.array(simulateStep), totalSeconds: z.number().int() });
export type SimulateResponse = z.infer<typeof simulateResponse>;

// ── Teams admin ─────────────────────────────────────────────────────────
export const createTeamInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    managerUserId: z.uuid().nullish(),
    backupUserId: z.uuid().nullish(),
    memberIds: z.array(z.uuid()).max(100).optional(),
    defaultCapacity: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const updateTeamInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    managerUserId: z.uuid().nullable().optional(),
    backupUserId: z.uuid().nullable().optional(),
    /** Ordered member ids (round-robin order). */
    memberIds: z.array(z.uuid()).max(100).optional(),
    defaultCapacity: z.number().int().min(1).max(100).optional(),
    routingMode: z.enum(['round_robin', 'first_to_claim']).optional(),
    routingRetrySeconds: z.number().int().min(1).max(86400).optional(),
    idleSeconds: z
      .number()
      .int()
      .min(1)
      .max(7 * 86400)
      .optional(),
    idleRetriggerEnabled: z.boolean().optional(),
    escalationPolicyId: z.uuid().optional(),
    version: z.number().int(),
  })
  .strict();
export const teamIdParams = z.object({ id: z.uuid() });

// ── Lead sources + web forms ────────────────────────────────────────────
export const webFormDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  teamId: z.uuid(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type WebFormDto = z.infer<typeof webFormDto>;
export const leadSourceDto = z.object({
  id: z.uuid(),
  key: z.string(),
  label: z.string(),
  kind: z.enum(['web_form', 'whatsapp', 'manual']),
});
export const intakeSettingsResponse = z.object({
  forms: z.array(webFormDto),
  sources: z.array(leadSourceDto),
});
export const updateWebFormInput = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,62}$/)
      .optional(),
    teamId: z.uuid().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int(),
  })
  .strict();
export const webFormIdParams = z.object({ id: z.uuid() });

// ── Time-warp (F10.2) ───────────────────────────────────────────────────
export const TIME_WARP_FACTORS = [1, 10, 60] as const;
export const timeWarpResponse = z.object({
  multiplier: z.number(),
  /** false → the workspace is not in demo mode; changing is refused. */
  demoMode: z.boolean(),
});
export const setTimeWarpInput = z
  .object({ multiplier: z.union([z.literal(1), z.literal(10), z.literal(60)]) })
  .strict();
export const setTimeWarpResponse = timeWarpResponse.extend({ rescheduledLeads: z.number().int() });

export const automationsEndpoints = {
  listPolicies: endpoint({ method: 'GET', path: '/api/v1/escalation-policies', response: policiesResponse }),
  createPolicy: endpoint({
    method: 'POST',
    path: '/api/v1/escalation-policies',
    body: createPolicyInput,
    response: policyDto,
  }),
  updatePolicy: endpoint({
    method: 'PUT',
    path: '/api/v1/escalation-policies/:id',
    params: policyIdParams,
    body: updatePolicyInput,
    response: policyDto,
  }),
  simulate: endpoint({
    method: 'POST',
    path: '/api/v1/escalation-policies/simulate',
    body: simulateInput,
    response: simulateResponse,
  }),
  createTeam: endpoint({ method: 'POST', path: '/api/v1/teams', body: createTeamInput, response: teamDto }),
  updateTeam: endpoint({
    method: 'PATCH',
    path: '/api/v1/teams/:id',
    params: teamIdParams,
    body: updateTeamInput,
    response: teamDto,
  }),
  intake: endpoint({ method: 'GET', path: '/api/v1/web-forms', response: intakeSettingsResponse }),
  updateWebForm: endpoint({
    method: 'PATCH',
    path: '/api/v1/web-forms/:id',
    params: webFormIdParams,
    body: updateWebFormInput,
    response: webFormDto,
  }),
  timeWarp: endpoint({ method: 'GET', path: '/api/v1/time-warp', response: timeWarpResponse }),
  setTimeWarp: endpoint({
    method: 'PUT',
    path: '/api/v1/time-warp',
    body: setTimeWarpInput,
    response: setTimeWarpResponse,
  }),
} as const;
