// CRM extras contracts (Lane B5): stage rot (T-221, F2.9), CSV import (T-226, F2.12), AI fields (T-219, F9.1),
// describe-your-business onboarding (T-218, F9.3). Docs: docs/11-api.md "CRM extras".
import { z } from 'zod';
import {
  aiOutputTypeSchema,
  fieldOption,
  fieldTypeSchema,
  fieldValueSchema,
  isoDate,
  localizedLabel,
  opportunityDto,
  stageKindSchema,
} from './crm';
import { endpoint } from './endpoint';

// ── Stage rot (F2.9) ────────────────────────────────────────────────────
export const rotItem = z.object({
  opportunity: opportunityDto,
  stageId: z.uuid(),
  stageName: z.string(),
  pipelineId: z.uuid(),
  /** The stage's configured rot period. */
  rotSeconds: z.number().int(),
  /** Time since the last recorded action, in configured (time-warp-scaled) seconds; always > rotSeconds. */
  idleSeconds: z.number().int(),
});
export type RotItem = z.infer<typeof rotItem>;
export const rottingResponse = z.object({ items: z.array(rotItem) });
export const rottingQuery = z.object({ pipelineId: z.uuid().optional() });

// ── CSV import (F2.12) ──────────────────────────────────────────────────
export const importRowInput = z.object({
  /** 1-based line number in the uploaded file (header = line 1): used in the report. */
  line: z.number().int().min(1).max(1_000_000),
  name: z.string().max(1000),
  phone: z.string().max(200).optional(),
  email: z.string().max(400).optional(),
  company: z.string().max(400).optional(),
  language: z.string().max(40).optional(),
  fields: z.record(z.uuid(), z.string().max(2500)).default({}),
});
export type ImportRowInput = z.input<typeof importRowInput>;
export const importChunkInput = z.object({
  /** Client-generated id that groups the chunks of one import (audit + timeline). */
  batchId: z.uuid(),
  /** false = validate only (dry run), true = write. */
  commit: z.boolean(),
  onDuplicate: z.enum(['update', 'skip']),
  rows: z.array(importRowInput).min(1).max(200),
});
export const importRowError = z.object({ field: z.string(), code: z.string() });
export const importRowResult = z.object({
  line: z.number().int(),
  /** What happens (dry run) or happened (commit) to the row. */
  status: z.enum(['create', 'update', 'skip', 'error']),
  contactId: z.uuid().nullable(),
  matchedBy: z.enum(['phone', 'email']).nullable(),
  errors: z.array(importRowError),
});
export type ImportRowResult = z.infer<typeof importRowResult>;
export const importChunkResponse = z.object({
  commit: z.boolean(),
  results: z.array(importRowResult),
  counts: z.object({
    create: z.number().int(),
    update: z.number().int(),
    skip: z.number().int(),
    error: z.number().int(),
  }),
});
export type ImportChunkResponse = z.infer<typeof importChunkResponse>;

// ── AI fields (F9.1) ────────────────────────────────────────────────────
export const aiFieldState = z.object({
  fieldId: z.uuid(),
  entity: z.enum(['contact', 'opportunity']),
  key: z.string(),
  label: localizedLabel,
  outputType: aiOutputTypeSchema,
  options: z.array(fieldOption),
  value: fieldValueSchema.nullable(),
  /** `human` = a person set/edited it: it wins and is never overwritten without `force`. */
  source: z.enum(['ai', 'human', 'import']).nullable(),
  filledAt: isoDate.nullable(),
});
export type AiFieldState = z.infer<typeof aiFieldState>;
export const aiFieldsQuery = z
  .object({ contactId: z.uuid().optional(), opportunityId: z.uuid().optional() })
  .refine((v) => Boolean(v.contactId) !== Boolean(v.opportunityId), { message: 'one_target' });
export const aiFieldsResponse = z.object({ aiEnabled: z.boolean(), items: z.array(aiFieldState) });
export const aiFieldsFillInput = z
  .object({
    contactId: z.uuid().optional(),
    opportunityId: z.uuid().optional(),
    /** One field; omitted = every AI field of the record. */
    fieldId: z.uuid().optional(),
    /** Overwrite a human-edited value (the explicit "unlock and refresh" action). */
    force: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.contactId) !== Boolean(v.opportunityId), { message: 'one_target' });
export const aiFillStatus = z.enum(['filled', 'unchanged', 'unknown', 'locked', 'ai_disabled', 'failed']);
export const aiFieldsFillResponse = z.object({
  aiEnabled: z.boolean(),
  results: z.array(z.object({ fieldId: z.uuid(), status: aiFillStatus })),
  items: z.array(aiFieldState),
});

// ── Describe-your-business onboarding (F9.3) ────────────────────────────
const proposalKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
export const proposalStage = z.object({
  name: z.string().trim().min(1).max(60),
  kind: stageKindSchema,
  /** Rot after N days without a recorded action (open stages only). */
  rotDays: z.number().int().min(1).max(365).nullable(),
  /** Keys of proposed (or existing) fields that must be filled before a deal enters this stage. */
  requiredFieldKeys: z.array(proposalKey).max(10),
});
export const proposalPipeline = z.object({
  name: z.string().trim().min(1).max(60),
  stages: z.array(proposalStage).min(2).max(12),
});
export const proposalField = z.object({
  entity: z.enum(['contact', 'opportunity']),
  key: proposalKey,
  label: localizedLabel,
  type: fieldTypeSchema.exclude(['ai']),
  options: z.array(fieldOption).max(20),
});
export const onboardingProposal = z.object({
  businessSummary: z.string().trim().max(300),
  pipelines: z.array(proposalPipeline).min(1).max(2),
  fields: z.array(proposalField).max(12),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
});
export type OnboardingProposal = z.infer<typeof onboardingProposal>;

export const onboardingTemplateDto = z.object({
  id: z.enum(['real_estate', 'solar', 'clinic']),
  name: localizedLabel,
  description: z.object({ en: z.string(), ur: z.string() }),
  proposal: onboardingProposal,
});
export type OnboardingTemplateDto = z.infer<typeof onboardingTemplateDto>;
export const onboardingTemplatesResponse = z.object({
  aiEnabled: z.boolean(),
  items: z.array(onboardingTemplateDto),
});
export const onboardingProposeInput = z
  .object({
    description: z.string().trim().min(3).max(600).optional(),
    templateId: onboardingTemplateDto.shape.id.optional(),
  })
  .refine((v) => Boolean(v.description) !== Boolean(v.templateId), { message: 'description_xor_template' });
export const onboardingProposeResponse = z.object({
  /** `template`: a built-in template (picked, or matched to the description because AI is off/failed). */
  source: z.enum(['ai', 'template', 'unavailable']),
  templateId: onboardingTemplateDto.shape.id.nullable(),
  proposal: onboardingProposal.nullable(),
  /** Why AI was not used (`disabled`, `timeout`, ...), for the UI note. */
  aiError: z.string().nullable(),
});
export const onboardingApplyInput = z.object({
  proposal: onboardingProposal,
  /** Make the first proposed pipeline the workspace default. */
  makeDefault: z.boolean().default(true),
});
export const onboardingApplyResponse = z.object({
  created: z.object({
    pipelines: z.number().int(),
    stages: z.number().int(),
    fields: z.number().int(),
    tags: z.number().int(),
  }),
  /** Already present by name/key: left untouched. */
  skipped: z.object({ pipelines: z.number().int(), fields: z.number().int(), tags: z.number().int() }),
  pipelineIds: z.array(z.uuid()),
});
export type OnboardingApplyResponse = z.infer<typeof onboardingApplyResponse>;

// ── Endpoints ───────────────────────────────────────────────────────────
export const crmExtrasEndpoints = {
  rotting: endpoint({
    method: 'GET',
    path: '/api/v1/opportunities/rotting',
    query: rottingQuery,
    response: rottingResponse,
  }),
  importChunk: endpoint({
    method: 'POST',
    path: '/api/v1/imports/contacts',
    body: importChunkInput,
    response: importChunkResponse,
  }),
  aiFieldsList: endpoint({
    method: 'GET',
    path: '/api/v1/ai-fields',
    query: aiFieldsQuery,
    response: aiFieldsResponse,
  }),
  aiFieldsFill: endpoint({
    method: 'POST',
    path: '/api/v1/ai-fields/fill',
    body: aiFieldsFillInput,
    response: aiFieldsFillResponse,
  }),
  onboardingTemplates: endpoint({
    method: 'GET',
    path: '/api/v1/onboarding/templates',
    response: onboardingTemplatesResponse,
  }),
  onboardingPropose: endpoint({
    method: 'POST',
    path: '/api/v1/onboarding/propose',
    body: onboardingProposeInput,
    response: onboardingProposeResponse,
  }),
  onboardingApply: endpoint({
    method: 'POST',
    path: '/api/v1/onboarding/apply',
    body: onboardingApplyInput,
    response: onboardingApplyResponse,
  }),
} as const;
